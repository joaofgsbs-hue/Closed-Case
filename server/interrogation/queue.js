// queue.js
// One waiting line per suspect.
//
// Problem: two players ask the same suspect at the same moment. If both
// questions went to the model together, each call would see the SAME memory,
// and the suspect could give two answers that contradict each other.
//
// Solution: a "promise chain". Each suspect has one promise that represents
// "the last job in line". A new job is attached to the end with .then(), so it
// only starts when everything before it has finished - and by then the
// previous answer is already stored in the suspect's memory.

/**
 * @param {Map<string, Promise>} queues  room.suspectQueues (one per room!)
 * @param {string} suspectId
 * @param {() => Promise} job
 * @returns {Promise} settles when THIS job is done
 */
export function enqueue(queues, suspectId, job) {
  const lastInLine = queues.get(suspectId) || Promise.resolve();
  // Run `job` after the previous one, whether that one succeeded or failed.
  const mine = lastInLine.then(job, job);
  // What we store must never reject, or it would break the line for the next job.
  queues.set(suspectId, mine.catch(() => {}));
  return mine;
}
