package com.canact.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Routes WebRTC voice-call audio between the device earpiece (default) and
 * the loud speakerphone. Without this, the WebView's PlaybackEngine plays
 * remote-stream audio through MEDIA stream which Android always renders
 * out the loudspeaker, regardless of the call kind — not the behaviour
 * users expect for a 1:1 voice call held against the ear.
 *
 * On startCall() we flip AudioManager into MODE_IN_COMMUNICATION (the same
 * mode WhatsApp / Signal use) AND grab transient voice-call audio focus
 * with USAGE_VOICE_COMMUNICATION + CONTENT_TYPE_SPEECH attributes. This
 * combination is what tells Chromium's WebView audio backend to bind the
 * remote MediaStream playback to STREAM_VOICE_CALL → the earpiece by
 * default. Without the focus request many devices keep the WebView's
 * <audio srcObject> playback on STREAM_MUSIC → loudspeaker, which is the
 * "always on speaker" behaviour the previous build exhibited.
 */
@CapacitorPlugin(name = "AudioRouter")
public class AudioRouterPlugin extends Plugin {

    private Integer savedMode = null;
    private Boolean savedSpeakerOn = null;
    private AudioFocusRequest focusRequest = null;
    private final Handler main = new Handler(Looper.getMainLooper());

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Apply mode + speaker route, then re-apply twice on the next loop
     *  ticks. Several OEM ROMs (Xiaomi, Samsung One UI 6+, OnePlus) reset
     *  the speakerphone flag the instant the AudioManager mode flips,
     *  which silently bounces voice calls back to the loudspeaker. The
     *  retries are cheap insurance.
     */
    private void applyRoute(AudioManager m, boolean speaker) {
        try { m.setMode(AudioManager.MODE_IN_COMMUNICATION); } catch (Throwable ignored) {}
        try { m.setSpeakerphoneOn(speaker); } catch (Throwable ignored) {}
        main.postDelayed(() -> { try { m.setSpeakerphoneOn(speaker); } catch (Throwable ignored) {} }, 120);
        main.postDelayed(() -> { try { m.setSpeakerphoneOn(speaker); } catch (Throwable ignored) {} }, 400);
    }

    private void requestVoiceFocus(AudioManager m) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            try {
                //noinspection deprecation
                m.requestAudioFocus(null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            } catch (Throwable ignored) {}
            return;
        }
        if (focusRequest != null) {
            try { m.abandonAudioFocusRequest(focusRequest); } catch (Throwable ignored) {}
            focusRequest = null;
        }
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .build();
            m.requestAudioFocus(focusRequest);
        } catch (Throwable ignored) {}
    }

    private void releaseVoiceFocus(AudioManager m) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            try {
                //noinspection deprecation
                m.abandonAudioFocus(null);
            } catch (Throwable ignored) {}
            return;
        }
        if (focusRequest != null) {
            try { m.abandonAudioFocusRequest(focusRequest); } catch (Throwable ignored) {}
            focusRequest = null;
        }
    }

    @PluginMethod
    public void startCall(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.reject("AudioManager unavailable"); return; }
        boolean speaker = Boolean.TRUE.equals(call.getBoolean("speaker", false));

        // Snapshot current state so endCall() can restore it.
        if (savedMode == null) savedMode = m.getMode();
        if (savedSpeakerOn == null) savedSpeakerOn = m.isSpeakerphoneOn();

        requestVoiceFocus(m);
        applyRoute(m, speaker);

        JSObject ret = new JSObject();
        ret.put("speaker", speaker);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.reject("AudioManager unavailable"); return; }
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        applyRoute(m, on);
        JSObject ret = new JSObject();
        ret.put("speaker", on);
        call.resolve(ret);
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.resolve(); return; }
        try {
            releaseVoiceFocus(m);
            if (savedSpeakerOn != null) m.setSpeakerphoneOn(savedSpeakerOn);
            if (savedMode != null) m.setMode(savedMode);
        } finally {
            savedMode = null;
            savedSpeakerOn = null;
        }
        call.resolve();
    }
}
