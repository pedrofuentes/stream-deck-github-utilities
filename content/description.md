<!-- 
  Marketplace Description — Stream Deck GitHub Utilities
  Last Updated: v1.3.2
  Character Limit: 4,000
  Current Count: ~2,850 characters
-->

# GitHub Utilities for Stream Deck

**Your GitHub dashboard, one glance away.** Monitor repositories, track CI/CD pipelines, and watch deployments — all from your Stream Deck.

GitHub Utilities puts the metrics that matter right at your fingertips. No more switching to browser tabs to check build status or star counts. Every button updates automatically, so your Stream Deck always shows the latest data.

---

## 🔢 Repo Stats

Turn any Stream Deck key into a live repository dashboard. Pick a stat, pick a repo — done.

- **Stars** — stargazer count with gold accent
- **Open Issues** — issue count with green accent
- **Forks** — fork count with blue accent
- **Watchers** — watcher count with purple accent
- **Pull Requests** — open PR count with green accent
- **Language** — primary language with salmon accent
- **Size** — repository size (auto-formatted KB/MB/GB)
- **License** — license type display
- **Default Branch** — branch name display
- **Visibility** — public/private status

**Short press** cycles through stat types on the fly. **Long press** opens the repository in your browser. Text too long? It scrolls automatically with a smooth marquee animation.

---

## ⚙️ Workflow Status

Monitor GitHub Actions workflows and deployments in real time.

- **Latest run status** — see success, failure, running, queued, cancelled, and more at a glance
- **Color-coded icons** — green for success, red for failure, yellow for in-progress, blue for queued, purple for deploying
- **Deployment tracking** — active deployments show a dedicated view with environment name
- **Smart filtering** — optionally filter by workflow file, branch, or deployment environment
- **Press to refresh** — instant status update on key press

14 distinct status states, each with its own icon and color, so you always know exactly what's happening.

---

## 🎯 Smart Property Inspector

Configuration is effortless with the intelligent Property Inspector.

- **One-time token setup** — enter your GitHub PAT once, it's shared across all buttons
- **Searchable dropdowns** — type to filter through repositories, workflows, branches, and environments
- **Auto-populated lists** — repos load from your account, sorted by most recently pushed
- **Cascading filters** — selecting a repo automatically loads its workflows, branches, and environments
- **Private repo support** — private repositories shown with a lock icon indicator

---

## 🔒 Privacy First

Your credentials never leave your machine. The GitHub Personal Access Token is stored locally in Stream Deck's plugin settings — it's never transmitted to any third-party server.

---

## 📋 Requirements

- Stream Deck software version 6.9 or higher
- macOS 13+ or Windows 10+
- A GitHub Personal Access Token (free — fine-grained tokens recommended)

---

## 🚀 Getting Started

1. **Install** the plugin from the Elgato Marketplace
2. **Create** a GitHub Personal Access Token at github.com/settings/tokens with Metadata (read), Actions (read), and Deployments (read) permissions
3. **Drag** a Repo Stats or Workflow Status action onto your Stream Deck
4. **Paste** your token in the Settings panel — repositories load automatically
5. **Select** a repository and configure your preferred stat or workflow filter
6. **Done!** Your button updates automatically on a configurable interval

---

Built with the official Elgato Stream Deck SDK. Open source under the MIT License.
