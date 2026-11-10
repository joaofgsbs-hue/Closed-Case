// publicView.js
// THE ONLY PLACE that turns a Room into data for a browser.
//
// Security rule of the whole project: handlers never send a Room object (or a
// piece of one) directly. They call toPublicRoom(), which builds a NEW object
// field by field. Anything not copied here - room.caseTruth, player tokens,
// socket ids - simply cannot leak, even by accident.
//
// `viewerId` is the player this view is for. Today every player sees the same
// thing plus "you"; in competitive / traitor modes the views will differ.

export function toPublicRoom(room, viewerId) {
  return {
    code: room.code,
    phase: room.phase,
    settings: {
      theme: room.settings.theme,
      difficulty: room.settings.difficulty,
      mode: room.settings.mode,
    },
    hostId: room.hostId,
    canStart: room.canStart(),
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      connected: player.connected,
      isHost: player.id === room.hostId,
      // deliberately NOT copied: token, socketId, removalTimer
    })),
    you: { id: viewerId },
  };
}
