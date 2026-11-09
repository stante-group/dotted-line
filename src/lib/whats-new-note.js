// The "What's new" note after an update (GitHub #8): which version's note, if any, the
// panel shows. Pure; background.js and panel.js do the storage.
//
// storage.local `whatsNew`: the version whose note hasn't been seen yet, or unset. Set on
// an update (never on a fresh install: the reports question is enough there). Removed by
// Dismiss, or by a draft made (background.js recordOk).

export const WHATS_NEW_KEY = "whatsNew";

/** What to store after chrome.runtime.onInstalled, or undefined to leave it as it is.
 *  Only an update to a new version that has a note. Reloading an unpacked test copy fires
 *  "update" every time with the same version: that changes nothing, or every reload would
 *  bring the note back. Updating to a version with no note leaves an earlier unseen note in
 *  place, since what it describes is still there. */
export function unseenAfterInstall(details, version, notes) {
  if (details?.reason !== "update") return undefined;
  if (!version || details.previousVersion === version) return undefined;
  return hasNote(notes, version) ? version : undefined;
}

/** {version, text} for the panel, or null: nothing unseen, or no note for that version. */
export function noteToShow(unseen, notes) {
  if (typeof unseen !== "string" || !hasNote(notes, unseen)) return null;
  return { version: unseen, text: notes[unseen].trim() };
}

function hasNote(notes, v) {
  return Object.prototype.hasOwnProperty.call(notes || {}, v) && typeof notes[v] === "string" && notes[v].trim() !== "";
}
