// rateLimit.js
// Stops one browser from flooding the server with messages.
// Method ("fixed window"): count messages in the current second; above the
// limit, drop them. Simple and good enough here.

const MAX_MESSAGES_PER_SECOND = 10;

export function attachRateLimit(socket) {
  let windowStart = Date.now();
  let count = 0;

  // socket.use() runs BEFORE every incoming event handler, like a checkpoint.
  // packet = [eventName, ...args]; the last arg may be the ack callback.
  socket.use((packet, next) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    count += 1;

    if (count > MAX_MESSAGES_PER_SECOND) {
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') ack({ ok: false, error: 'Too many messages. Slow down.' });
      return; // not calling next() means the event is dropped
    }
    next();
  });
}
