import VolumeMeter from './volume-meter';
import { AudioDetection } from './audioDetection';

export function connectAudioDetection(audioContext: AudioContext, stream: MediaStream): AudioDetection {
  // Create an AudioNode from the stream.
  const mediaStreamSource = audioContext.createMediaStreamSource(stream);

  // Create a new volume meter and connect it.
  const volumeMeter = new VolumeMeter(audioContext);
  mediaStreamSource.connect(volumeMeter.processor);

  return new AudioDetection(volumeMeter);
}
