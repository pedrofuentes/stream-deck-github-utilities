/**
 * Plugin entry point — registers actions and connects to Stream Deck.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import streamDeck from "@elgato/streamdeck";

import { RepoStatsAction } from "./actions/repo-stats";
import { WorkflowStatusAction } from "./actions/workflow-status";
import { PRCounterAction } from "./actions/pr-counter";
import { IssueCounterAction } from "./actions/issue-counter";
import { ReleaseMonitorAction } from "./actions/release-monitor";
import { CommitActivityAction } from "./actions/commit-activity";
import { BranchComparisonAction } from "./actions/branch-comparison";
import { BranchNetworkAction } from "./actions/branch-network";
import { PRReviewQueueAction } from "./actions/pr-review-queue";

// Configure the logger
streamDeck.logger.setLevel("debug");

// Register actions
streamDeck.actions.registerAction(new RepoStatsAction());
streamDeck.actions.registerAction(new WorkflowStatusAction());
streamDeck.actions.registerAction(new PRCounterAction());
streamDeck.actions.registerAction(new IssueCounterAction());
streamDeck.actions.registerAction(new ReleaseMonitorAction());
streamDeck.actions.registerAction(new CommitActivityAction());
streamDeck.actions.registerAction(new BranchComparisonAction());
streamDeck.actions.registerAction(new BranchNetworkAction());
streamDeck.actions.registerAction(new PRReviewQueueAction());

// Connect to the Stream Deck
streamDeck.connect();
