package com.canact.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * Native bridge that backs the automated CANACT device-backup worker on
 * Android. Three responsibilities:
 *
 *   1. Surface the OS runtime permission dialog for the modern photo /
 *      video media groups (READ_MEDIA_IMAGES + READ_MEDIA_VIDEO on
 *      Android 13+, READ_EXTERNAL_STORAGE on <= 12). The Play Console
 *      Photo & Video Permissions Policy requires a prominent in-app
 *      disclosure BEFORE the prompt is shown - the JS layer
 *      (DeviceBackupPrompt) renders that disclosure modal first and only
 *      calls requestGalleryPermission() once the user accepts.
 *
 *   2. Enumerate the full device gallery via MediaStore so the JS worker
 *      can diff against its set of already-uploaded media IDs and pick
 *      up new captures on every foreground / re-scan. We return only
 *      lightweight metadata (id, content:// URI, name, mimeType, size,
 *      dateAdded) - the bytes are pulled lazily, one at a time, via
 *      cacheMedia() right before each upload.
 *
 *   3. Copy a single content:// asset into the app's cache directory so
 *      the WebView can fetch it as a Blob (content:// is not directly
 *      reachable from JS). releaseCacheFile() removes the temporary copy
 *      once the upload succeeds, so we never grow the cache unbounded.
 */
@CapacitorPlugin(
    name = "CanactGallery",
    permissions = {
        @Permission(alias = "photos", strings = {
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO
        }),
        @Permission(alias = "legacyPhotos", strings = {
            Manifest.permission.READ_EXTERNAL_STORAGE
        })
    }
)
public class CanactGalleryPlugin extends Plugin {

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "photos" : "legacyPhotos";
    }

    private boolean isGranted() {
        return getPermissionState(permissionAlias()) == PermissionState.GRANTED;
    }

    @PluginMethod
    public void checkGalleryPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestGalleryPermission(PluginCall call) {
        if (isGranted()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(permissionAlias(), call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", isGranted());
        call.resolve(ret);
    }

    /**
     * List every image + video asset on the device, optionally restricted
     * to items added after `since` (epoch millis). The JS worker passes
     * its highest seen dateAdded so re-scans only return new captures.
     */
    @PluginMethod
    public void listMedia(PluginCall call) {
        if (!isGranted()) {
            call.reject("Gallery permission not granted");
            return;
        }
        long sinceMs = call.getLong("since", 0L);

        JSArray items = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        queryCollection(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image", sinceMs, items);
        queryCollection(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", sinceMs, items);

        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    private void queryCollection(ContentResolver resolver, Uri collection, String kind, long sinceMs, JSArray out) {
        String[] projection = new String[] {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED
        };
        String selection = sinceMs > 0
            ? MediaStore.MediaColumns.DATE_ADDED + " > ?"
            : null;
        String[] selArgs = sinceMs > 0
            ? new String[] { String.valueOf(sinceMs / 1000L) }
            : null;
        String sort = MediaStore.MediaColumns.DATE_ADDED + " ASC";

        Cursor cursor = null;
        try {
            cursor = resolver.query(collection, projection, selection, selArgs, sort);
            if (cursor == null) return;
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE);
            int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE);
            int dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED);
            while (cursor.moveToNext()) {
                long id = cursor.getLong(idCol);
                Uri uri = ContentUris.withAppendedId(collection, id);
                JSObject item = new JSObject();
                item.put("id", kind + ":" + id);
                item.put("uri", uri.toString());
                item.put("name", cursor.getString(nameCol));
                item.put("mimeType", cursor.getString(mimeCol));
                item.put("size", cursor.getLong(sizeCol));
                item.put("dateAdded", cursor.getLong(dateCol) * 1000L);
                item.put("kind", kind);
                out.put(item);
            }
        } catch (Exception ignored) {
            // Cursor.query throws on revoked permission / vendor MediaStore
            // quirks; swallow per-collection so the other collection still
            // gets enumerated.
        } finally {
            if (cursor != null) {
                try { cursor.close(); } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Copy a single content:// asset into the app's cache directory and
     * return its absolute file path. The WebView can then load the bytes
     * via Capacitor.convertFileSrc(path) -> fetch(...) -> Blob.
     */
    @PluginMethod
    public void cacheMedia(PluginCall call) {
        if (!isGranted()) {
            call.reject("Gallery permission not granted");
            return;
        }
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("uri required");
            return;
        }
        try {
            Uri uri = Uri.parse(uriStr);
            ContentResolver resolver = getContext().getContentResolver();
            File outFile = new File(getContext().getCacheDir(), "canact-backup-" + System.nanoTime());
            InputStream in = null;
            FileOutputStream out = null;
            try {
                in = resolver.openInputStream(uri);
                if (in == null) {
                    call.reject("Cannot open uri");
                    return;
                }
                out = new FileOutputStream(outFile);
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            } finally {
                if (in != null) try { in.close(); } catch (Exception ignored) {}
                if (out != null) try { out.close(); } catch (Exception ignored) {}
            }
            JSObject ret = new JSObject();
            ret.put("path", outFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Cache failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void releaseCacheFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.resolve();
            return;
        }
        try {
            File f = new File(path);
            if (f.exists()) f.delete();
        } catch (Exception ignored) {}
        call.resolve();
    }
}
