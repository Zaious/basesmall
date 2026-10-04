// The subset of the MLB Stats API "GUMBO" live feed (/api/v1.1/game/{pk}/feed/live)
// that the adapter reads. Field names verified against real responses in docs/PROBE_REPORT.md.
// Everything is optional where a field was missing in at least one season we sampled.

export interface MlbRef {
  id: number;
  fullName?: string;
  link?: string;
}

export interface MlbCount {
  balls: number;
  strikes: number;
  outs: number;
}

export interface MlbPlayEvent {
  index: number;
  type: string; // 'pitch' | 'action' | 'no_pitch' | 'pickoff' | 'stepoff' | ...
  isPitch: boolean;
  startTime?: string;
  endTime?: string;
  count: MlbCount;
  player?: { id: number };
  /** Set on runner_placed (the extra-innings runner) and pinch-runner substitutions: 1, 2 or 3. */
  base?: number;
  /** Set on substitutions: who left the game. */
  replacedPlayer?: { id: number };
  /** Set on substitutions: the batting-order slot taken, "301" = the first change in the 3rd spot. */
  battingOrder?: string;
  position?: { abbreviation?: string };
  details?: {
    description?: string;
    eventType?: string;
    event?: string;
    code?: string;
    call?: { code?: string; description?: string };
    type?: { code?: string; description?: string };
    isInPlay?: boolean;
    isBall?: boolean;
    isStrike?: boolean;
    isOut?: boolean;
    awayScore?: number;
    homeScore?: number;
  };
  pitchData?: {
    startSpeed?: number;
    strikeZoneTop?: number;
    strikeZoneBottom?: number;
    zone?: number;
    coordinates?: { pX?: number; pZ?: number };
  };
  hitData?: {
    location?: string;
    trajectory?: string;
    hardness?: string;
    launchSpeed?: number;
    launchAngle?: number;
    totalDistance?: number;
    coordinates?: { coordX?: number; coordY?: number };
  };
}

export interface MlbRunner {
  movement: {
    originBase?: string | null;
    start: string | null;
    end: string | null;
    outBase?: string | null;
    isOut: boolean;
    outNumber?: number | null;
  };
  details: {
    eventType?: string;
    runner: MlbRef;
    playIndex: number;
    rbi?: boolean;
    isScoringEvent?: boolean;
  };
  credits?: { credit: string; position?: { abbreviation?: string } }[];
}

export interface MlbPlay {
  result: {
    type?: string;
    event?: string;
    eventType?: string;
    description?: string;
    rbi?: number;
    awayScore?: number;
    homeScore?: number;
    isOut?: boolean;
  };
  about: {
    atBatIndex: number;
    halfInning: 'top' | 'bottom';
    isTopInning: boolean;
    inning: number;
    isComplete: boolean;
    startTime?: string;
    endTime?: string;
  };
  count: MlbCount;
  matchup: {
    batter: MlbRef;
    pitcher: MlbRef;
    batSide?: { code?: string };
    pitchHand?: { code?: string };
    postOnFirst?: MlbRef;
    postOnSecond?: MlbRef;
    postOnThird?: MlbRef;
  };
  runners: MlbRunner[];
  playEvents: MlbPlayEvent[];
}

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
}

export interface MlbFeed {
  gamePk: number;
  metaData?: { wait?: number; timeStamp?: string };
  gameData: {
    status: { abstractGameState?: string; detailedState?: string; codedGameState?: string };
    teams: { away: MlbTeam; home: MlbTeam };
    players?: Record<string, {
      id: number; fullName?: string; lastName?: string; boxscoreName?: string;
      primaryPosition?: { abbreviation?: string }; batSide?: { code?: string }; pitchHand?: { code?: string };
    }>;
    /** R regular season; F, D, L, W the postseason rounds; S spring training. */
    game?: { type?: string; season?: string };
    datetime?: { officialDate?: string };
    /** firstPitch is set once the game starts; gameDurationMinutes once it ends (delays excluded). */
    gameInfo?: { firstPitch?: string; gameDurationMinutes?: number };
  };
  liveData: {
    plays: { allPlays: MlbPlay[] };
    /** Only the parts the hover card reads. seasonStats are postseason totals in October. */
    boxscore?: {
      teams?: Record<'away' | 'home', {
        /** The batting order now (the final one once the game is over): player ids. */
        battingOrder?: number[];
        /** Pitchers who have pitched, in order. */
        pitchers?: number[];
        players?: Record<string, {
          person?: { id: number };
          position?: { abbreviation?: string };
          /** "100" ... "900": the starter in that spot; "101": the first change there. */
          battingOrder?: string;
          /** Positions played, the first one at the start. */
          allPositions?: { abbreviation?: string }[];
          seasonStats?: {
            batting?: { avg?: string; homeRuns?: number; rbi?: number; ops?: string; atBats?: number };
            pitching?: { era?: string; inningsPitched?: string; strikeOuts?: number; wins?: number; losses?: number; gamesPlayed?: number };
          };
        }>;
      }>;
    };
    linescore?: {
      scheduledInnings?: number;
      teams?: Record<'away' | 'home', { runs?: number; hits?: number; errors?: number }>;
      /** Runs is absent for a half-inning that has not been played or did not count. */
      innings?: { num: number; away?: { runs?: number }; home?: { runs?: number } }[];
    };
  };
}
