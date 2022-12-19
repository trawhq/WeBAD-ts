/*
The MIT License (MIT)

Copyright (c) 2014 Chris Wilson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/*

Usage:
const meter = new VolumeMeter(audioContext, clipLevel, averaging, clipLag);

audioContext: the AudioContext you're using.
clipLevel: the level (0 to 1) that you would consider "clipping".
   Defaults to 0.98.
averaging: how "smoothed" you would like the meter to be over time.
   Should be between 0 and less than 1.  Defaults to 0.95.
clipLag: how long you would like the "clipping" indicator to show
   after clipping has occured, in milliseconds.  Defaults to 750ms.

Access the clipping through node.checkClipping(); use node.shutdown to get rid of it.
*/

export default class VolumeMeter {
  public readonly clipLevel: number;
  public readonly averaging: number;
  public readonly clipLag: number;

  public readonly processor: ScriptProcessorNode;

  public readonly audioContext: AudioContext;
  public volume = 0;
  public lastClip = 0;
  public clipping = false;

  constructor(audioContext: AudioContext, clipLevel = 0.98, averaging = 0.95, clipLag = 750) {
    this.processor = audioContext.createScriptProcessor(512);
    this.audioContext = audioContext;
    this.clipLevel = clipLevel;
    this.averaging = averaging;
    this.clipLag = clipLag;

    // this will have no effect, since we don't copy the input to the output,
    // but works around a current Chrome bug.
    this.processor.connect(this.audioContext.destination);
    this.processor.onaudioprocess = this.volumeAudioProcess.bind(this);
  }

  volumeAudioProcess(event: AudioProcessingEvent) {
    const buf = event.inputBuffer.getChannelData(0);
    const bufLength = buf.length;
    let sum = 0;
    let x;

    // Do a root-mean-square on the samples: sum up the squares...
    for (let i = 0; i < bufLength; i++) {
      x = buf[i];
      if (Math.abs(x) >= this.clipLevel) {
        this.clipping = true;
        this.lastClip = self.performance.now();
      }
      sum += x * x;
    }

    // ... then take the square root of the sum.
    const rms = Math.sqrt(sum / bufLength);

    // Now smooth this out with the averaging factor applied
    // to the previous sample - take the max here because we
    // want "fast attack, slow release."
    this.volume = Math.max(rms, this.volume * this.averaging);
  }

  checkClipping(): boolean {
    if (!this.clipping) {
      return false;
    }
    if (this.lastClip + this.clipLag < window.performance.now()) {
      this.clipping = false;
    }
    return this.clipping;
  }

  shutdown() {
    this.processor.disconnect();
    this.processor.onaudioprocess = null;
  }
}
