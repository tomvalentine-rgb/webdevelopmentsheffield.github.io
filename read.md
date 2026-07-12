# Web Development Sheffield

This repository contains the source code and static site generation workflows for **Web Development Sheffield**. The project utilises a modern decoupled stack using **Sanity CMS** for headless content management and custom automated build scripts to compile the dynamic blog pages into blazing-fast static assets.

---

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed on your machine (LTS version recommended).

### Installation

1. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/tomvalentine-rgb/webdevelopmentsheffield.github.io
   cd ourwebsite
   ```

2. Install the project dependencies:
   ```bash
   npm install
   ```

---

## 🛠️ Development & Building

### 1. Running the Site Locally

IntelliJ IDEA's built-in preview server (running on port `63342`) alters the URL structure by prepending the project folder name, which breaks absolute asset paths (like `/css/style.css`).

To test the project in an environment identical to production (GitHub Pages), use a dedicated local web server at the repository root:

```bash
npx serve
```

Once running, open the local address provided in your terminal (usually `http://localhost:3000`). This ensures all absolute and relative paths route flawlessly.

### 2. Compiling the Blog (Sanity CMS Sync)

The project leverages **Sanity CMS** to power its blog content. When articles are published or updated in the CMS, they must be compiled into local static files before deploying.

To fetch the latest content from Sanity and generate the corresponding blog posts and directory structure, execute our custom build script:

```bash
node scripts/build-blog.mjs
```

**What this script does:**
* Connects to the Sanity client API.
* Pulls down all blog posts, metadata, and asset references.
* Generates optimised static HTML structures inside the `/blog/` directory (e.g., creating clean, SEO-friendly slugs like `/blog/how-to-get-your-business-to-show-up-on-google-maps/index.html`).

### 3. Github Actions Auto Blog Builder

There is a github actions pipeline that will run every day at around 6am which will go and collect the latest information from sanity. If there is a new blog it will build the blog html using the script. 

YAML build script is: `.github/workflows/build-blog.yml`

---

## 📂 Project Structure

```text
ourwebsite/
├── .github/                 # GitHub workflows & deployment configs
│   └── workflows     
│       └── build-blog.yaml  # GitHub actions for automatically generating a blog page from Sanity CMS
├── .idea/                   
├── assets/                  # Shared images and static media assets
├── blog/                    # Generated blog posts (built dynamically via script)
├── css/                     # Styling sheets
│   └── style.css            # Core global styles
├── js/                      # Frontend JavaScript
├── scripts/                 # Automation scripts
│   └── build-blog.mjs       # Sanity CMS fetcher & HTML compiler
├── index.html               # Website landing page
├── package.json             # Dependencies and project scripts
└── sanity.json / config     # Sanity configuration integration (if tracked here)
```

---

## 🌐 Deployment

This website is automatically deployed via **GitHub Pages** whenever changes are merged into the primary branch.

**Deployment Checklist:**
1. Update content or write a new post in the **Sanity Studio Dashboard**.
2. Run `node scripts/build-blog.mjs` locally to generate the new static files.
3. Commit and push the newly generated static HTML pages along with any source changes:
   ```bash
   git add .
   git commit -m "feat: sync latest blog updates from Sanity CMS"
   git push origin main
   ```
4. GitHub Actions will handle the compilation verification and serve the update directly to [webdevelopmentsheffield.co.uk](https://webdevelopmentsheffield.co.uk/).