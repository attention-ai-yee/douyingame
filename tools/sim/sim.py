#!/usr/bin/env python3
"""《御兽山海》数值模拟器。

读取 client/assets/resources/config/*.json（和游戏用的是同一份配置），
模拟"看广告型"和"不看广告型"两类玩家每天的推图、抽兽、升星、觉醒、镇妖塔进度。

用法：
    python3 tools/sim/sim.py                     # 默认 120 天、每类玩家 12 次取中位数
    python3 tools/sim/sim.py --days 180 --seeds 20
    python3 tools/sim/sim.py --no-tower          # 不开镇妖塔（对照 v0.2）
    python3 tools/sim/sim.py --legacy            # 关掉 v0.4 之后补进模拟的奖励，复现文档 v0.4 的数字

只用 Python 标准库。玩家行为假设在 tools/sim/scenarios.json。
"""
import argparse
import json
import math
import random
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "client" / "assets" / "resources" / "config"
SCENARIO_FILE = Path(__file__).with_name("scenarios.json")
RARITY_ORDER_HIGH_FIRST = ("chuanshuo", "xi", "ling", "fan")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_config(config_dir=CONFIG_DIR):
    names = ("beasts", "pools", "progression", "stages", "reveal", "ads", "signin")
    return {n: load_json(Path(config_dir) / f"{n}.json") for n in names}


class Model:
    """从配置表推导出的公式，和 core/formulas.ts 保持一致。"""

    def __init__(self, cfg):
        b, pools, prog, st = cfg["beasts"], cfg["pools"], cfg["progression"], cfg["stages"]
        self.cfg = cfg
        self.beast = {x["id"]: (x["rarity"], x["element"]) for x in b["beasts"]}
        self.rarity_power = {k: v["power"] for k, v in b["rarities"].items()}
        self.star_costs = prog["star"]["costs"]
        self.star_mults = prog["star"]["mults"]
        self.awk_costs = prog["awaken"]["shardCosts"]
        self.awk_mults = prog["awaken"]["mults"]
        slot = prog["slot"]
        self.slot_cost_base, self.slot_cost_growth, self.slot_stat_growth = slot["costBase"], slot["costGrowth"], slot["statGrowth"]
        self.slot_unlocks = sorted(slot["unlocks"], key=lambda u: u["stage"])
        self.syn_two, self.syn_four = prog["synergyPower"]["two"], prog["synergyPower"]["four"]
        g = prog["gold"]
        self.gold = g
        self.assist_mult, self.assist_cap = prog["assist"]["powerMult"], prog["assist"]["dailyCap"]
        self.wild = prog["wild"]
        self.task_tickets = prog["daily"]["taskTickets"]
        # 兽池
        self.mountains = sorted(pools["mountains"], key=lambda m: m["chapter"])
        self.depth_rates = {k: v["rates"] for k, v in pools["depths"].items()}
        self.deep_unlock = pools["deepUnlockWithinChapter"]
        self.pity_xi, self.pity_cs = pools["pity"]["xi"], pools["pity"]["chuanshuo"]
        self.free_ten = pools["dailyFreeTenPulls"]
        # 主线
        self.chapter_len = st["chapterLength"]
        self.chapters = st["chapters"]
        self.max_stage = self.chapter_len * len(self.chapters)
        e = st["enemy"]
        self.enemy_cfg = e
        self.enemy_base_tbl = {1: float(e["base"])}
        for n in range(2, self.max_stage + 1):
            self.enemy_base_tbl[n] = self.enemy_base_tbl[n - 1] * self._seg_growth(n)
        self.small_boss_tickets = st["rewards"]["smallBossTickets"]
        self.tower = st["tower"]
        self.ln_main = {n: math.log(v) for n, v in self.enemy_base_tbl.items()}
        self.beyond_growth = e["segments"][-1]["growth"]
        t = self.tower
        self.f_max_main = 1 + math.log(self.enemy_base_tbl[self.max_stage] / self.enemy_base_tbl[t["baseStage"]]) / math.log(t["growth"])
        self.ads = cfg["ads"]
        self.signin = cfg["signin"]["firstRound"]

    def _seg_growth(self, n):
        for s in self.enemy_cfg["segments"]:
            if s["from"] <= n <= s["to"]:
                return s["growth"]
        return self.enemy_cfg["segments"][-1]["growth"]

    def enemy(self, n):
        v = self.enemy_base_tbl[n]
        e = self.enemy_cfg
        if n % self.chapter_len == 0:
            v *= e["chapterBossMult"]
        elif n % e["smallBossEvery"] == 0:
            v *= e["smallBossMult"]
        return v

    def tower_enemy(self, f):
        t = self.tower
        v = self.enemy_base_tbl[t["baseStage"]] * t["growth"] ** (f - 1)
        return v * (t["bossMult"] if f % t["bossEvery"] == 0 else 1.0)

    def eq_stage_of_strength(self, strength):
        ls = math.log(strength)
        if ls >= self.ln_main[self.max_stage]:
            return self.max_stage + (ls - self.ln_main[self.max_stage]) / math.log(self.beyond_growth)
        for n in range(1, self.max_stage):
            if self.ln_main[n + 1] > ls:
                return n + (ls - self.ln_main[n]) / (self.ln_main[n + 1] - self.ln_main[n])
        return float(self.max_stage)

    def tower_eq_stage(self, floor):
        t = self.tower
        if floor <= 0:
            return 0.0
        if floor <= self.f_max_main:
            return self.eq_stage_of_strength(self.enemy_base_tbl[t["baseStage"]] * t["growth"] ** (floor - 1))
        return self.max_stage + t["postMainStagePerFloor"] * (floor - self.f_max_main)

    def gold_per_min(self, eq_stage):
        g = self.gold
        return g["perMinBase"] * g["perMinGrowth"] ** (max(1.0, eq_stage) - 1)

    def slot_mult(self, lv):
        return self.slot_stat_growth ** (lv - 1)

    def slot_cost(self, lv):
        return self.slot_cost_base * self.slot_cost_growth ** (lv - 1)

    def slots(self, stage):
        k = 0
        for u in self.slot_unlocks:
            if stage >= u["stage"]:
                k = u["slots"]
        return k


class Player:
    def __init__(self, model, scen, ptype, seed, tower=True, awaken_from_day=None, extras=True):
        self.m, self.scen, self.ptype = model, scen, ptype
        self.rng = random.Random(seed)
        self.ad = ptype["watchAds"]
        self.tower_on, self.extras = tower, extras
        self.awaken_from_day = awaken_from_day
        self.own, self.shard, self.awk = {}, {}, {}
        self.wild_shards = {"fan": 0, "ling": 0, "xi": 0, "chuanshuo": 0}
        self.lv = [1] * 5
        self.gold = 0.0
        self.stage = self.floor = 0
        self.pr = self.pl = 0
        self.day = 1
        self.assist = 0
        self.ads = 0
        self.wild_today = 0
        self.wild_store = 0
        self.wild_clock_h = 0.0
        for b in scen["tutorialBeasts"]:
            self.add(b)

    # ---------- 收集 ----------
    def awaken_on(self):
        return self.awaken_from_day is not None and self.day >= self.awaken_from_day

    def add(self, b, extra=0):
        if b in self.own:
            self.shard[b] = self.shard.get(b, 0) + 1 + extra
        else:
            self.own[b], self.shard[b], self.awk[b] = 1, extra, 0
        self.starup()

    def starup(self):
        m = self.m
        for b in self.own:
            r = m.beast[b][0]
            while True:
                if self.own[b] < 5:
                    cost = m.star_costs[self.own[b] - 1]
                elif self.awaken_on() and self.awk[b] < 5:
                    cost = m.awk_costs[self.awk[b]]
                else:
                    break
                have = self.shard.get(b, 0)
                if have < cost:
                    need = cost - have
                    if self.wild_shards.get(r, 0) >= need:
                        self.wild_shards[r] -= need
                        have += need
                    else:
                        break
                self.shard[b] = have - cost
                if self.own[b] < 5:
                    self.own[b] += 1
                else:
                    self.awk[b] += 1

    def unit(self, b):
        m = self.m
        r = m.beast[b][0]
        return m.rarity_power[r] * m.star_mults[self.own[b] - 1] * m.awk_mults[self.awk[b]]

    def power(self):
        m = self.m
        k = m.slots(self.stage)
        bs = sorted(self.own, key=lambda b: -self.unit(b))[:k]
        els = [m.beast[b][1] for b in bs]
        syn = 1.0
        for e in set(els):
            c = els.count(e)
            syn += (m.syn_two if c >= 2 else 0) + (m.syn_four if c >= 4 else 0)
        vals = sorted((self.unit(b) for b in bs), reverse=True)
        return sum(v * m.slot_mult(self.lv[i]) for i, v in enumerate(vals)) * syn

    # ---------- 抽兽（玩家总在最新解锁的山抽） ----------
    def pull(self, k):
        m = self.m
        mi = min(len(m.mountains), self.stage // m.chapter_len + 1)
        mountain = m.mountains[mi - 1]
        within = self.stage - (mi - 1) * m.chapter_len
        if self.stage >= mi * m.chapter_len:
            depth = "secret"
        else:
            depth = "deep" if within >= m.deep_unlock else "shallow"
        rates = m.depth_rates[depth]
        for _ in range(k):
            self.pr += 1
            self.pl += 1
            x, acc, r = self.rng.random(), 0.0, "fan"
            for r in RARITY_ORDER_HIGH_FIRST:
                acc += rates[r]
                if x < acc:
                    break
            if self.pl >= m.pity_cs:
                r = "chuanshuo"
            elif self.pr >= m.pity_xi and r not in ("xi", "chuanshuo"):
                r = "xi"
            if r == "chuanshuo":
                self.pl = self.pr = 0
            if r == "xi":
                self.pr = 0
            opts = mountain["tiers"][r]
            y = self.rng.random() * sum(w for _, w in opts)
            for b, w in opts:
                y -= w
                if y < 0:
                    break
            seal = 1 if (r in ("xi", "chuanshuo") and self.rng.random() < self.scen["sealBonusChance"]) else 0
            self.add(b, seal)

    # ---------- 金币 ----------
    def eq_stage(self):
        eq = float(self.stage)
        if self.tower_on and self.floor > 0:
            eq = max(eq, self.m.tower_eq_stage(self.floor))
        return eq

    def idle(self):
        return self.m.gold_per_min(self.eq_stage())

    def spend(self):
        m = self.m
        k = m.slots(self.stage)
        while True:
            i = min(range(k), key=lambda j: self.lv[j])
            c = m.slot_cost(self.lv[i])
            if self.gold < c:
                break
            self.gold -= c
            self.lv[i] += 1

    # ---------- 推进 ----------
    def try_clear(self, need, is_boss):
        pw = self.power()
        if pw >= need:
            return True
        if self.ad and is_boss and self.assist > 0 and pw * self.m.assist_mult >= need:
            self.assist -= 1
            self.ads += 1
            return True
        return False

    def wild_encounter(self):
        if self.extras and self.wild_today >= self.m.wild["dailyCap"]:
            return
        self.wild_today += 1
        self.pull(1)

    def push(self):
        m = self.m
        g = m.gold
        e = m.enemy_cfg
        while self.stage < m.max_stage and self.try_clear(m.enemy(self.stage + 1), (self.stage + 1) % e["smallBossEvery"] == 0):
            self.stage += 1
            n = self.stage
            first = g["firstClearMinutes"] * self.idle()
            if self.extras and n % g["treasureEvery"] == 0 and n % e["smallBossEvery"] != 0:
                first *= g["treasureMult"]
            self.gold += first
            self.spend()
            if self.rng.random() < m.wild["stageClearChance"]:
                self.wild_encounter()
            if self.extras:
                if n % m.chapter_len == 0:
                    boss = m.chapters[n // m.chapter_len - 1]["boss"]
                    if boss.get("rewardTickets"):
                        self.pull(boss["rewardTickets"])
                    if boss.get("captureBeast"):
                        seal = 1 if self.rng.random() < self.scen["sealBonusChance"] else 0
                        self.add(boss["captureBeast"], seal)
                elif n % e["smallBossEvery"] == 0:
                    self.pull(m.small_boss_tickets)
        t = m.tower
        if self.tower_on and self.stage >= t["unlockStage"]:
            rw = t["rewards"]
            while self.try_clear(m.tower_enemy(self.floor + 1), (self.floor + 1) % t["bossEvery"] == 0):
                self.floor += 1
                f = self.floor
                if f % rw["ticketsEvery"] == 0:
                    self.pull(rw["tickets"])
                if f % rw["lingWildEvery"] == 0:
                    self.wild_shards["ling"] += 1
                if f % rw["xiWildEvery"] == 0:
                    self.wild_shards["xi"] += 1
                self.starup()
                self.gold += m.gold["firstClearMinutes"] * self.idle()
                self.spend()
                if f > 20000:
                    break

    def tick_wild_clock(self, hours):
        if not self.extras:
            return
        w = self.m.wild
        self.wild_clock_h += hours
        while self.wild_clock_h >= w["idleEveryHours"]:
            self.wild_clock_h -= w["idleEveryHours"]
            self.wild_store = min(w["idleStoreCap"], self.wild_store + 1)

    def claim_stored_wild(self):
        while self.wild_store > 0:
            self.wild_store -= 1
            self.wild_encounter()

    def online(self, minutes):
        for _ in range(minutes):
            self.gold += self.idle()
            self.spend()
            self.push()
        self.tick_wild_clock(minutes / 60)

    def offline(self, hours, first_of_day):
        g = self.m.gold
        gold = self.idle() * 60 * min(g["offlineCapHours"], hours) * g["offlineRatio"]
        if self.ad:
            gold *= 3 if first_of_day else 2
            self.ads += 1
        self.gold += gold
        self.spend()
        self.tick_wild_clock(hours)
        self.push()


def apply_signin(p, day):
    m = p.m
    if day < 1 or day > len(m.signin) or day == 1:  # 第 1 天的九尾狐在新手引导里已经给了
        return 0
    item = m.signin[day - 1]
    tickets = item.get("tickets", 0)
    if "beast" in item:
        p.add(item["beast"])
    if "choice" in item:
        p.add(item["choice"][0])
    for r, n in item.get("wild", {}).items():
        p.wild_shards[r] += n
    if p.extras and item.get("goldMinutes"):
        p.gold += item["goldMinutes"] * p.idle()
    p.starup()
    return tickets


def run(model, scen, ptype_name, days, seed, tower=True, awaken_from_day=None, extras=True):
    ptype = scen["players"][ptype_name]
    p = Player(model, scen, ptype, seed, tower=tower, awaken_from_day=awaken_from_day, extras=extras)
    ad_tickets = model.ads["rewarded"]["tickets"]["tickets"]
    out, last = {}, None
    for day in range(1, days + 1):
        p.day = day
        p.assist = model.assist_cap
        p.wild_today = 0
        bonus_tickets = apply_signin(p, day)
        if day == 1:
            sessions = scen["sessions"]["day1"]
            views = ptype["day1AdTicketViews"] if p.ad else 0
            pulls = model.free_ten * 10 + views * ad_tickets
        else:
            sessions = scen["sessions"]["daily"]
            views = ptype["adTicketViews"] if p.ad else 0
            pulls = model.free_ten * 10 + model.task_tickets + views * ad_tickets + bonus_tickets
        p.ads += views
        first = True
        for i, (hr, mins) in enumerate(sessions):
            t = (day - 1) * 24 + hr
            if last is not None:
                p.offline(t - last, first)
                first = False
            p.claim_stored_wild()
            k = pulls // (len(sessions) - i)
            pulls -= k
            p.pull(k)
            p.push()
            p.online(mins)
            last = t + mins / 60
        v = list(p.own.values())
        out[day] = dict(stage=p.stage, floor=p.floor, uniq=len(v), star=sum(v) / len(v),
                        s5=sum(x == 5 for x in v), awk=sum(p.awk.values()) / len(v),
                        lv=p.lv[0], ads=p.ads / day)
    return out


def report(model, scen, days, seeds, tower, awaken_from_day, extras):
    show = [d for d in (1, 2, 3, 5, 7, 10, 14, 21, 30, 40, 60, 90, 120, 150, 180) if d <= days]
    rows = (("stage", "主线关卡", "{:>6.0f}"), ("floor", "镇妖塔层", "{:>6.0f}"), ("uniq", "图鉴数", "{:>6.0f}"),
            ("star", "平均星级", "{:>6.1f}"), ("s5", "5星只数", "{:>6.0f}"), ("awk", "觉醒均阶", "{:>6.1f}"))
    for name in scen["players"]:
        res = [run(model, scen, name, days, s, tower, awaken_from_day, extras) for s in range(seeds)]

        def med(d, k):
            return statistics.median(r[d][k] for r in res)

        print(f"\n=== {scen['players'][name]['label']}（{seeds} 次中位数）===")
        print("  天      " + "".join(f"{d:>6}" for d in show))
        for key, label, fmt in rows:
            if key == "floor" and not tower:
                continue
            if key == "awk" and awaken_from_day is None:
                continue
            print(f"  {label:<6}" + "".join(fmt.format(med(d, key)) for d in show))
        end = next((d for d in range(1, days + 1) if med(d, "stage") >= model.max_stage), None)
        print(f"  打完主线：{'约第 %d 天' % end if end else '模拟期内未打完'}")
        if tower and end:
            pts = [end] + [d for d in (60, 90, 120, 180) if end < d <= days]
            segs = [f"第{a}～{b}天 {(med(b, 'floor') - med(a, 'floor')) / (b - a):.1f}" for a, b in zip(pts, pts[1:])]
            if segs:
                print("  主线打完后每天推塔层数：" + "，".join(segs))
        if scen["players"][name]["watchAds"]:
            print("  人均激励/日（累计平均）：" + "，".join(f"第{d}天 {med(d, 'ads'):.1f}" for d in (30, 90, 180) if d <= days))


def main():
    ap = argparse.ArgumentParser(description="《御兽山海》数值模拟器")
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--seeds", type=int, default=None, help="每类玩家模拟次数（默认取 scenarios.json）")
    ap.add_argument("--no-tower", action="store_true", help="不开镇妖塔")
    ap.add_argument("--awaken-day", type=int, default=None, help="第几天开放觉醒（默认取 scenarios.json，-1 表示不开）")
    ap.add_argument("--legacy", action="store_true", help="复现文档 v0.4 的口径：不算宝箱关、Boss 奖励、挂机野遇、签到金币")
    ap.add_argument("--config", type=str, default=str(CONFIG_DIR))
    args = ap.parse_args()
    cfg = load_config(args.config)
    scen = load_json(SCENARIO_FILE)
    model = Model(cfg)
    awaken_day = scen["awakenFromDay"] if args.awaken_day is None else args.awaken_day
    if awaken_day is not None and awaken_day < 0:
        awaken_day = None
    seeds = args.seeds or scen["seeds"]
    print(f"配置目录：{args.config}")
    print(f"镇妖塔：{'关' if args.no_tower else '开'}；觉醒：{'第 %d 天起' % awaken_day if awaken_day else '不开'}；口径：{'v0.4 文档' if args.legacy else '完整'}")
    report(model, scen, args.days, seeds, not args.no_tower, awaken_day, not args.legacy)


if __name__ == "__main__":
    main()
