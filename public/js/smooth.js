// Smooths pen input before it becomes stroke points, so a line follows the
// hand's motion instead of every small jitter in the samples.
//
// Two steps run on each raw point:
//   1. A point closer than MIN_STEP page units to the last kept point is
//      dropped. A slow pen sends many nearly identical samples, and those
//      tiny steps are where the jitter lives.
//   2. Each kept point is replaced by the average of the last WINDOW kept
//      points. Averaging pulls bumps toward the line's path.
// The average trails the pen by a few samples, so end() returns the pen's
// last raw point, and the line still ends exactly where the pen lifted.
// The rendering then draws curves through the smoothed points.
const MIN_STEP = 1.5;
const WINDOW = 3;

export function createSmoother(first) {
  const recent = [first];
  let lastRaw = first;
  let lastOut = first;

  return {
    // Returns the smoothed point, or null when the raw point was dropped.
    push(point) {
      lastRaw = point;
      const prev = recent.at(-1);
      if (Math.hypot(point[0] - prev[0], point[1] - prev[1]) < MIN_STEP) return null;
      recent.push(point);
      if (recent.length > WINDOW) recent.shift();
      const n = recent.length;
      const sum = recent.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      lastOut = [round(sum[0] / n, 10), round(sum[1] / n, 10), round(sum[2] / n, 100)];
      return lastOut;
    },

    // The pen's last raw point, when the smoothed line has not reached it.
    end() {
      const same = lastRaw[0] === lastOut[0] && lastRaw[1] === lastOut[1];
      return same ? null : lastRaw;
    },
  };
}

function round(n, factor) {
  return Math.round(n * factor) / factor;
}
