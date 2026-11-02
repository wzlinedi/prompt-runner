// All checks of the walk-through, by group (the registry that the coverage test and the run read).
import { flowChecks } from './flow.mjs';
import { exportChecks } from './exports.mjs';
import { privacyChecks } from './privacy.mjs';
import { keyboardChecks } from './keyboard.mjs';
import { appearanceChecks } from './appearance.mjs';
import { keyguardChecks } from './keyguard.mjs';

export const CHECKS = [...flowChecks, ...exportChecks, ...privacyChecks, ...keyboardChecks, ...appearanceChecks, ...keyguardChecks];
