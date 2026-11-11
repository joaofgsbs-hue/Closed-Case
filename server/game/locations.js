// locations.js
// Searching a location. It costs one of the room's shared actions, and
// reveals the place's description and every clue hidden there - to everyone.
// Going back to a place already searched is free: there is nothing new to find.

/**
 * @returns {{ok: true, alreadySearched?: boolean} | {ok: false, error: string}}
 * Synchronous on purpose: Node runs one handler at a time, so two players
 * clicking the same place at the same moment cannot both spend an action.
 */
export function searchLocation(room, player, locationId) {
  if (room.phase !== 'investigation') return { ok: false, error: 'There is no investigation in progress.' };

  const location = room.caseTruth.locations.find((l) => l.id === locationId);
  if (!location) return { ok: false, error: 'There is no such place.' };

  if (room.searched.has(locationId)) return { ok: true, alreadySearched: true };
  if (room.actionsLeft <= 0) return { ok: false, error: 'No actions left today. Use what you have found.' };

  room.actionsLeft -= 1;
  room.searched.set(locationId, { by: player.name });
  for (const clue of room.caseTruth.clues) {
    if (clue.locationId === locationId && !room.foundClues.has(clue.id)) {
      room.foundClues.set(clue.id, { by: player.name });
    }
  }
  return { ok: true };
}
