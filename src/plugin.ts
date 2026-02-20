import streamDeck from "@elgato/streamdeck";

import { RepoStatsAction } from "./actions/repo-stats";
import { WorkflowStatusAction } from "./actions/workflow-status";

// Configure the logger
streamDeck.logger.setLevel("debug");

// Register actions
streamDeck.actions.registerAction(new RepoStatsAction());
streamDeck.actions.registerAction(new WorkflowStatusAction());

// Connect to the Stream Deck
streamDeck.connect();
