'use client';

import { useEffect } from 'react';

/**
 * Previously this component fired its own FirebaseMessaging permission
 * prompt as soon as the app booted. That ran in parallel with
 * `NativePermissionsBootstrapper` and caused several Android permission
 * dialogs to stack on top of each other on first launch — easy for the
 * user to miss or accidentally dismiss the wrong one.
 *
 * The full sequential prompt chain now lives in
 * `NativePermissionsBootstrapper`. We keep this file as a no-op so any
 * stale imports keep working without a build break.
 */
export default function EarlyPermissionsPrompt() {
  useEffect(() => { /* intentionally empty — see jsdoc above */ }, []);
  return null;
}

