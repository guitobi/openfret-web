// Karplus-Strong pluck synth for the audio thread.
// Messages:
//   { type: 'pluck', frame, midi, durFrames, gain } — schedule one pluck at absolute frame
//   { type: 'panic' }                               — clear queue, fade out all voices
class PluckProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._queued = []
    this._voices = []
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.type === 'pluck') {
        this._queued.push(m)
      } else if (m.type === 'panic') {
        this._queued.length = 0
        for (const v of this._voices) v.releasing = true
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    out.fill(0)
    const now = currentFrame

    // Promote due plucks (sorted by target frame).
    if (this._queued.length > 1) this._queued.sort((a, b) => a.frame - b.frame)
    while (this._queued.length && this._queued[0].frame <= now) {
      const p = this._queued.shift()
      const freq = 440 * Math.pow(2, (p.midi - 69) / 12)
      const size = Math.max(2, Math.round(sampleRate / freq))
      const line = new Float32Array(size)
      for (let i = 0; i < size; i++) line[i] = (Math.random() * 2 - 1) * p.gain
      this._voices.push({
        line,
        idx: 0,
        age: 0,
        durFrames: p.durFrames,
        releasing: false,
        env: 1,
      })
    }

    // Render voices in place.
    for (let vi = this._voices.length - 1; vi >= 0; vi--) {
      const v = this._voices[vi]
      const line = v.line
      const size = line.length
      for (let i = 0; i < out.length; i++) {
        const cur = line[v.idx]
        const nxt = line[(v.idx + 1) % size]
        line[v.idx] = (cur + nxt) * 0.5 * 0.996 // averaging filter = natural decay
        v.age++
        if (v.releasing || v.age > v.durFrames) {
          v.env *= 0.9995
        }
        out[i] += cur * v.env
        v.idx = (v.idx + 1) % size
      }
      if (v.env < 0.001) this._voices.splice(vi, 1)
    }
    return true
  }
}
registerProcessor('pluck-processor', PluckProcessor)
