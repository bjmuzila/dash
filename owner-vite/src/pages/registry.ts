import type { ComponentType } from "react";
import Hub from "./Hub";
import ControlPanel from "./ControlPanel";
import Admin from "./Admin";
import Sales from "./Sales";
import Probe from "./Probe";
import Results from "./Results";
import Backtests from "./Backtests";
import Tree from "./Tree";
import Greeks from "./Greeks";
import Dev from "./Dev";
import Database from "./Database";
import EstimatedMove from "./EstimatedMove";
import Changelog from "./Changelog";
import SocialMedia from "./SocialMedia";
import Emails from "./Emails";
import PostStudio from "./PostStudio";
import Budget from "./Budget";
import Todo from "./Todo";

/** key (from lib/nav.ts) → page component. */
export const PAGES: Record<string, ComponentType> = {
  Hub,
  ControlPanel,
  Admin,
  Sales,
  Probe,
  Results,
  Backtests,
  Tree,
  Greeks,
  Dev,
  Database,
  EstimatedMove,
  Changelog,
  SocialMedia,
  Emails,
  PostStudio,
  Budget,
  Todo,
};
