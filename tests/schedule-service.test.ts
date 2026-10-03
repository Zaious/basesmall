import { describe, expect, it } from 'vitest';
import { ScheduleService } from '../src/data/mlb/schedule-service.ts';
import { FakeClock } from './fake-clock.ts';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const game = (pk: number) => ({
  gamePk: pk, gameType: 'R', gameDate: '2026-09-25T23:00:00Z', officialDate: '2026-09-25', status: { abstractGameState: 'Live', codedGameState: 'I' },
  teams: { away: { team: { id: 1, abbreviation: 'AAA', name: 'A' }, score: 1 }, home: { team: { id: 2, abbreviation: 'HHH', name: 'H' }, score: 0 } },
  linescore: { currentInning: 5, isTopInning: false, outs: 1, offense: { first: { id: 9 } } },
});

function setup() {
  const clock = new FakeClock();
  const paths: string[] = [];
  const svc = new ScheduleService(async (p) => { paths.push(p); return { dates: [{ date: '2026-09-25', games: [game(1), game(2)] }] }; }, () => '2026-09-25', clock, 60_000);
  return { clock, paths, svc };
}

describe('ScheduleService', () => {
  it('polls only while someone wants it, once a minute', async () => {
    const { clock, paths, svc } = setup();
    const seen: number[] = [];
    svc.subscribe((c) => seen.push(c.length));
    clock.advance(10 * 60_000);
    expect(paths).toHaveLength(0);
    svc.want('scoreboard', true);
    clock.advance(0); await flush();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('date=2026-09-25');
    for (let i = 0; i < 3; i++) { clock.advance(60_000); await flush(); }
    expect(paths).toHaveLength(4);
    expect(seen).toEqual([2, 2, 2, 2]);
    svc.want('scoreboard', false);
    clock.advance(10 * 60_000); await flush();
    expect(paths).toHaveLength(4);
  });

  it('two wanters share one poller; it stops when the last one leaves', async () => {
    const { clock, paths, svc } = setup();
    svc.want('notices', true);
    svc.want('scoreboard', true);
    clock.advance(0); await flush();
    clock.advance(60_000); await flush();
    expect(paths).toHaveLength(2);
    svc.want('notices', false);
    clock.advance(60_000); await flush();
    expect(paths).toHaveLength(3);
    svc.want('scoreboard', false);
    clock.advance(5 * 60_000); await flush();
    expect(paths).toHaveLength(3);
  });

  it('reads cards with the live situation', async () => {
    const { clock, svc } = setup();
    svc.want('x', true);
    clock.advance(0); await flush();
    expect(svc.cards[0]).toMatchObject({ gamePk: 1, status: 'live', inning: 5, half: 'bottom', outs: 1, bases: ['1B'], away: { runs: 1 } });
  });

  it("caches a team's window for five minutes", async () => {
    const { clock, paths, svc } = setup();
    await svc.team(147);
    await svc.team(147);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('teamId=147&startDate=2026-09-15&endDate=2026-10-15');
    clock.advance(5 * 60_000 + 1);
    await svc.team(147);
    expect(paths).toHaveLength(2);
  });
});
