"use client";

import { HOME_THEME } from "./homeTheme";

/**
 * ChaseScene — the Bzila error-page mascot animation. (~20s, plays ONCE, holds on win)
 *
 * Story (role-reversal chase, Bzila is armed the whole time):
 *   0.0s  Bzila sprints in from the right ALREADY HOLDING the green arrow, RED bear-arrow chasing.
 *   4.0s  He TRIPS and faceplants — bear nearly nabs him.
 *   6.5s  Scrambles up, JUMPS over a candlestick obstacle (green arrow still in hand).
 *   9.5s  Bzila skids, turns, raises the green arrow — the tables turn.
 *  11.0s  The RED bear panics, sprints to the BACK and HIDES behind a tall candle.
 *  14.0s  Bzila stalks to the back, finds it.
 *  16.5s  STAB — flash + shards. Bear tumbles out from hiding, defeated.
 *  18.0s+ Bzila strides back to center, green arrow raised — WIN.
 *
 * Pure CSS keyframes (no JS timers) so it works inside React error boundaries
 * and in the standalone Cloudflare page from identical markup.
 * Logo must live at /bzila-hero.png.
 */
export default function ChaseScene({ logoSrc = "/bzila-hero.png" }: { logoSrc?: string }) {
  return (
    <div className="bz-stage" aria-hidden>
      <div className="bz-floor" />

      {/* "504" sign at the BACK the red bear hides behind */}
      <div className="bz-hidewall"><span>504</span></div>

      {/* RED arrow — chaser, then panics and hides, then victim */}
      <svg className="bz-red" viewBox="0 0 120 120" width="84" height="84">
        <defs>
          <linearGradient id="bzRed" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff6b6b" />
            <stop offset="100%" stopColor={HOME_THEME.red} />
          </linearGradient>
        </defs>
        <path
          d="M18 20 L48 56 L66 38 L102 92 L70 92 L70 70 L52 88 L18 46 Z"
          fill="url(#bzRed)"
          stroke="#7f1d1d"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>

      {/* shards on the stab hit */}
      <span className="bz-shard bz-shard-1" />
      <span className="bz-shard bz-shard-2" />
      <span className="bz-shard bz-shard-3" />
      <span className="bz-shard bz-shard-4" />

      {/* BZILA hero — wrapper does X-travel; inner does the gags; the green arrow is a child held in hand */}
      <div className="bz-hero">
        <div className="bz-hero-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="Bzila" className="bz-hero-img" />
          <span className="bz-dust" />
          {/* GREEN arrow carried in-hand the whole time */}
          <svg className="bz-green" viewBox="0 0 120 120" width="60" height="60">
            <defs>
              <linearGradient id="bzGreen" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#1FD98A" />
                <stop offset="100%" stopColor="#8ECAE6" />
              </linearGradient>
            </defs>
            <path
              d="M18 100 L52 64 L70 82 L102 28 L70 28 L70 50 L52 32 L18 74 Z"
              fill="url(#bzGreen)"
              stroke="#065f46"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* impact flash */}
      <span className="bz-flash" />

      <style>{`
        .bz-stage {
          position: relative;
          width: 100%;
          max-width: 600px;
          height: 250px;
          margin: 0 auto;
          overflow: hidden;
          user-select: none;
        }
        .bz-floor {
          position: absolute;
          left: 4%;
          right: 4%;
          bottom: 46px;
          height: 2px;
          background: linear-gradient(90deg, transparent, ${HOME_THEME.cyan}55, transparent);
          box-shadow: 0 0 12px ${HOME_THEME.cyan}40;
        }

        /* "504" sign at the BACK the red bear hides behind (NOT a candle). Sits in FRONT of the bear. */
        .bz-hidewall {
          position: absolute;
          bottom: 60px;            /* "back" = higher + smaller, faux-depth */
          left: 50%;
          margin-left: -22px;
          width: 44px;
          height: 32px;
          border-radius: 5px;
          background: linear-gradient(180deg, #1a2230, #0d1119);
          border: 1px solid ${HOME_THEME.cyan}55;
          box-shadow: 0 0 12px rgba(0,0,0,.5);
          transform: translateX(140px) scale(.85);
          z-index: 6;
          display: flex; align-items: center; justify-content: center;
        }
        .bz-hidewall span {
          font: 700 15px/1 'Inter', Arial, sans-serif;
          color: ${HOME_THEME.cyan};
          letter-spacing: 0.06em;
        }
        /* signpost leg */
        .bz-hidewall::after {
          content: ""; position: absolute; left: 50%; bottom: -16px; width: 3px; height: 16px;
          background: #1a2230; margin-left: -1.5px;
        }

        /* ---- BZILA HERO ---- */
        .bz-hero {
          position: absolute;
          bottom: 40px;
          left: 50%;
          width: 96px;
          height: 96px;
          margin-left: -48px;
          z-index: 4;
          animation: bzHeroX 20s cubic-bezier(.45,.05,.35,1) forwards;
        }
        .bz-hero-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform-origin: 50% 90%;
          animation: bzHeroGag 20s ease-in-out forwards;
        }
        .bz-hero-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid ${HOME_THEME.cyan}88;
          box-shadow: 0 0 22px ${HOME_THEME.cyan}55, 0 6px 18px rgba(0,0,0,.6);
          background: ${HOME_THEME.panel};
          animation: bzHeroBob 0.4s ease-in-out infinite;
        }

        /* horizontal travel: run R->L (trip, jump), turn, stalk RIGHT to the back, stab, return center */
        @keyframes bzHeroX {
          0%   { transform: translateX(380px); }   /* enter from right */
          16%  { transform: translateX(-30px); }   /* running left */
          20%  { transform: translateX(-40px); }   /* TRIP point */
          28%  { transform: translateX(-40px); }   /* sprawled */
          37%  { transform: translateX(-110px); }  /* approach + jump obstacle */
          43%  { transform: translateX(-150px); }  /* land */
          50%  { transform: translateX(-150px); }  /* skid, turn, raise arrow */
          58%  { transform: translateX(-90px); }   /* bear flees past, Bzila pivots to chase */
          72%  { transform: translateX(90px); }    /* stalk toward the back hide spot */
          80%  { transform: translateX(120px); }   /* reach the candle */
          84%  { transform: translateX(130px); }   /* STAB lunge */
          88%  { transform: translateX(110px); }   /* recoil */
          100% { transform: translateX(0px); }     /* stride back to center, victory */
        }

        /* comedy + facing + arrow-raise layer */
        @keyframes bzHeroGag {
          0%   { transform: scaleX(-1) translateY(0) rotate(0deg); }      /* face left, running */
          19%  { transform: scaleX(-1) translateY(0) rotate(0deg); }
          22%  { transform: scaleX(-1) translateY(18px) rotate(-78deg); } /* FACEPLANT */
          28%  { transform: scaleX(-1) translateY(18px) rotate(-82deg); } /* lying there */
          32%  { transform: scaleX(-1) translateY(0) rotate(0deg); }      /* up again, keeps running */
          50%  { transform: scaleX(-1) translateY(0) rotate(0deg); }      /* turn moment */
          54%  { transform: scaleX(1)  translateY(0) rotate(0deg); }      /* now FACING RIGHT, hunting */
          84%  { transform: scaleX(1)  translateY(0) rotate(8deg); }      /* lunge/stab */
          100% { transform: scaleX(1)  translateY(0) rotate(0deg); }      /* win */
        }
        @keyframes bzHeroBob { 0%,100%{ translate:0 0 } 50%{ translate:0 -4px } }

        /* GREEN arrow held in Bzila's hand — tucked while running, raised when hunting/stabbing */
        .bz-green {
          position: absolute;
          right: -12px;
          top: 30px;
          z-index: 5;
          filter: drop-shadow(0 0 8px #1FD98A88);
          transform-origin: 50% 80%;
          animation: bzGreenHeld 20s ease-in-out forwards;
        }
        @keyframes bzGreenHeld {
          0%,19%  { transform: rotate(35deg) translateY(0); }    /* tucked, pointing back while fleeing */
          22%,32% { transform: rotate(80deg) translateY(10px); } /* flops as he faceplants */
          50%     { transform: rotate(-20deg); }                 /* raise it on the turn */
          54%     { transform: rotate(-35deg); }                 /* brandished, hunting */
          84%     { transform: rotate(40deg); }                  /* thrust forward on stab */
          88%     { transform: rotate(20deg); }
          100%    { transform: rotate(-30deg); }                 /* held aloft, victory */
        }

        /* dust puff on faceplant */
        .bz-dust {
          position: absolute;
          bottom: -2px; left: 50%;
          width: 10px; height: 10px; margin-left: -5px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,.5), transparent 70%);
          opacity: 0;
          animation: bzDust 20s linear forwards;
        }
        @keyframes bzDust {
          0%,21.5%{ opacity:0; transform:scale(.3) }
          23%{ opacity:.9; transform:scale(2) translateX(8px) }
          28%{ opacity:0; transform:scale(3) translateX(16px) }
          100%{ opacity:0 }
        }

        /* ---- RED ARROW (chaser -> panics -> hides -> victim) ---- */
        .bz-red {
          position: absolute;
          bottom: 44px;
          left: 50%;
          margin-left: -42px;
          z-index: 3;
          filter: drop-shadow(0 0 10px ${HOME_THEME.red}66);
          animation: bzRedMove 20s cubic-bezier(.45,.05,.35,1) forwards;
        }
        @keyframes bzRedMove {
          0%   { transform: translateX(500px) rotate(8deg); opacity: 1; }
          16%  { transform: translateX(50px) rotate(8deg); }                 /* right behind hero */
          22%  { transform: translateX(30px) rotate(20deg); }                /* nearly nabs tripped hero */
          43%  { transform: translateX(-60px) rotate(8deg); }                /* still chasing left */
          50%  { transform: translateX(-90px) rotate(8deg) scaleX(1); }      /* Bzila turns — uh oh */
          54%  { transform: translateX(-60px) rotate(-6deg) scaleX(-1); }    /* PANIC: spins around */
          64%  { transform: translateX(60px)  rotate(-6deg) scaleX(-1); }    /* flees right toward back */
          74%  { transform: translateX(150px) rotate(-6deg) scale(.82) scaleX(-1); } /* dives behind candle (back) */
          80%  { transform: translateX(150px) rotate(-6deg) scale(.82) scaleX(-1); } /* hiding, peeking */
          83%  { transform: translateX(140px) rotate(10deg) scale(.85) scaleX(-1); } /* yanked out */
          84%  { transform: translateX(132px) rotate(18deg) scale(.9); }     /* STAB IMPACT */
          85%  { transform: translateX(132px) rotate(18deg) scale(.8); opacity:.95; }
          90%  { transform: translateX(150px) rotate(70deg) translateY(26px) scale(.82); opacity:.95; } /* knocked back, toppling */
          95%  { transform: translateX(158px) rotate(96deg) translateY(46px) scale(.82); opacity:.85; } /* hits the floor */
          98%  { transform: translateX(158px) rotate(86deg) translateY(46px) scale(.82); opacity:.8; }  /* little bounce settle */
          100% { transform: translateX(158px) rotate(90deg) translateY(46px) scale(.82); opacity:.75; } /* lies flat on the ground, defeated */
        }

        /* ---- IMPACT FLASH (at the back hide spot) ---- */
        .bz-flash {
          position: absolute;
          bottom: 84px;
          left: 50%;
          margin-left: 60px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: radial-gradient(circle, #fff 0%, ${HOME_THEME.orange} 40%, transparent 70%);
          opacity: 0;
          z-index: 6;
          animation: bzFlash 20s linear forwards;
        }
        @keyframes bzFlash {
          0%, 83.4% { opacity: 0; transform: scale(0.2); }
          84%       { opacity: 1; transform: scale(3.0); }
          87%       { opacity: 0; transform: scale(3.8); }
          100%      { opacity: 0; }
        }

        /* ---- SHARDS (at the back hide spot) ---- */
        .bz-shard {
          position: absolute;
          bottom: 90px; left: 50%;
          margin-left: 56px;
          width: 6px; height: 6px;
          background: ${HOME_THEME.red};
          opacity: 0; z-index: 6; border-radius: 1px;
        }
        .bz-shard-1 { animation: bzShard1 20s ease-out forwards; }
        .bz-shard-2 { animation: bzShard2 20s ease-out forwards; }
        .bz-shard-3 { animation: bzShard3 20s ease-out forwards; }
        .bz-shard-4 { animation: bzShard4 20s ease-out forwards; }
        @keyframes bzShard1 { 0%,83.4%{opacity:0;transform:translate(0,0) rotate(0)} 84%{opacity:1} 91%,100%{opacity:0;transform:translate(40px,-34px) rotate(220deg)} }
        @keyframes bzShard2 { 0%,83.4%{opacity:0;transform:translate(0,0) rotate(0)} 84%{opacity:1} 91%,100%{opacity:0;transform:translate(34px,24px) rotate(-180deg)} }
        @keyframes bzShard3 { 0%,83.4%{opacity:0;transform:translate(0,0) rotate(0)} 84%{opacity:1} 91%,100%{opacity:0;transform:translate(22px,-46px) rotate(300deg)} }
        @keyframes bzShard4 { 0%,83.4%{opacity:0;transform:translate(0,0) rotate(0)} 84%{opacity:1} 91%,100%{opacity:0;transform:translate(52px,6px) rotate(-260deg)} }

        @media (prefers-reduced-motion: reduce) {
          .bz-hero, .bz-hero-inner, .bz-red, .bz-green, .bz-flash, .bz-shard, .bz-hero-img, .bz-dust {
            animation: none !important;
          }
          .bz-hero { transform: translateX(0); }
          .bz-hero-inner { transform: scaleX(1); }
          .bz-green { transform: rotate(-30deg); }
          .bz-red { opacity: 0; }
          .bz-hidewall { display: none; }
        }
      `}</style>
    </div>
  );
}
