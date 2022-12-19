export type SilenceEventDetail = {
  detail: {
    event: 'silence';
    volume: number;
    timestamp: number;
    duration: number;
    items: number;
    abort: string | undefined;
  };
};

export type MuteEventDetail = {
  detail: {
    event: 'mute';
    volume: number;
    timestamp: number;
    duration: number;
  };
};

export type PreSpeechStartEventDetail = {
  detail: {
    event: 'prespeechstart';
    volume: number;
    timestamp: number;
    items: number;
  };
};
