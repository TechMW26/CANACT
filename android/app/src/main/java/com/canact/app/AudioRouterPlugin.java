package com.canact.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Routes WebRTC voice-call audio between the device earpiece (default) and
 * the loud speakerphone. Without this, the WebView's PlaybackEngine plays
 * remote-stream audio through MEDIA stream which Android always renders
 * out the loudspeaker, regardless of the call kind \u2014 not the behaviour
 * users expect for a 1:1 voice call held against the ear.
 *
 * On startCall() we flip AudioManager into MODE_IN_COMMUNICATION (the same
 * mode WhatsApp / Signal use), which:
 *   1. Routes the WebRTC AudioTrack through the VOICE_CALL stream.
 *   2. Sends that stream out the earpiece by default.
 *   3. Makes the hardware volume rocker control in-call volume.
 * The JS side then calls setSpeaker(true|false) when the user toggles the
 * speaker button. endCall() restores MODE_NORMAL so other apps' media
 * isn't stuck on the call channel after the user hangs up.
 */
@CapacitorPlugin(name = "AudioRouter")
public class AudioRouterPlugin extends Plugin {

    private Integer savedMode = null;
    private Boolean savedSpeakerOn = null;

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void startCall(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.reject("AudioManager unavailable"); return; }
        boolean speaker = call.getBoolean("speaker", false);

        // Snapshot current state so endCall() can restore it.
        if (savedMode == null) savedMode = m.getMode();
        if (savedSpeakerOn == null) savedSpeakerOn = m.isSpeakerphoneOn();

        m.setMode(AudioManager.MODE_IN_COMMUNICATION);
        m.setSpeakerphoneOn(speaker);

        JSObject ret = new JSObject();
        ret.put("speaker", speaker);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.reject("AudioManager unavailable"); return; }
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        // Stay in IN_COMMUNICATION mode \u2014 just flip the route.
        if (m.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
            m.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        m.setSpeakerphoneOn(on);
        JSObject ret = new JSObject();
        ret.put("speaker", on);
        call.resolve(ret);
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        AudioManager m = am();
        if (m == null) { call.resolve(); return; }
        try {
            if (savedSpeakerOn != null) m.setSpeakerphoneOn(savedSpeakerOn);
            if (savedMode != null) m.setMode(savedMode);
        } finally {
            savedMode = null;
            savedSpeakerOn = null;
        }
        call.resolve();
    }
}
