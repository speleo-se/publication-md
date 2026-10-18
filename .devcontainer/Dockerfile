# Dev container image for publication-md — Claude Code + PDF tools.
#
# claude-shared kit v4 — this file was copied into this repository, not referenced.
# It is yours: it builds without any registry login, and nothing outside this repo
# has to resolve for it to work.
#
# Everything ABOVE the sentinel near the bottom is kit-owned and is replaced
# wholesale by `sync-project.sh`. Everything BELOW it is yours and is never touched.
# Put project tools down there.
FROM node:26

# Basic development tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  jq \
  locales \
  mc \
  tmux \
  wget \
  curl \
  ca-certificates \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# GitHub CLI from GitHub's own apt repository, not Debian's.
# Debian's gh lags upstream badly (bookworm shipped 2.23.0, from early 2023) and
# `gh repo create` is step one of this kit's own workflow, so take it from source.
# This layer is what makes `gh --version` report the current release.
RUN wget -qO /usr/share/keyrings/githubcli-archive-keyring.gpg \
      https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Generate en_US.UTF-8. VS Code forwards LC_ALL=en_US.UTF-8 from the host, and the
# node image ships no generated locales — so without this every single shell, and
# every command that starts one, prints "setlocale: LC_ALL: cannot change locale".
# Invisible in the Dockerfile, impossible to miss in a terminal.
RUN sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen \
  && locale-gen \
  && update-locale LANG=en_US.UTF-8

# Ensure default node user has access to /usr/local/share/npm-global
RUN mkdir -p /usr/local/share/npm-global/lib /usr/local/share/npm-global/bin && \
  chown -R node:node /usr/local/share/npm-global

# pnpm, installed directly — NOT via corepack.
#
# Node stopped shipping corepack in v25: "(SEMVER-MAJOR) build: stop distributing
# Corepack" (nodejs/node#57617), plus "remove corepack from release tarballs"
# (#59835). So `corepack enable` on node:26 fails with exit 127, command not found.
#
# The v26.x changelog still carries "deps: update corepack to 0.36.0" entries, which
# look like evidence it is bundled — they only track the vendored copy in Node's
# source tree. It is not installed. Do not "restore" corepack on the strength of them.
#
# Runs as root before USER node, so this lands in /usr/local/bin and is on PATH for
# every user. NPM_CONFIG_PREFIX is set later and does not affect it.
RUN npm install -g pnpm@10

ARG USERNAME=node

# Persist bash history. The volume is declared in devcontainer.json.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# /home/node/.claude and /home/node/.config must pre-exist as node-owned. Docker
# gives a named volume the ownership of its mount point at creation time, so if a
# project mounts one at e.g. /home/node/.config/gdrive3 and the parent is missing,
# Docker creates the parent as root — and then anything writing elsewhere under
# .config (wrangler and miniflare both do) fails with EACCES, a long way from the
# cause. The same applies to the ~/.claude volume and the skills mount inside it.
RUN mkdir -p /workspace /home/node/.claude/skills /home/node/.config && \
  chown -R node:node /workspace /home/node/.claude /home/node/.config

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Uncomment for ad-hoc `sudo apt-get install` inside a running container.
# Convenient, with two caveats: files created via sudo in the bind-mounted
# workspace land root-owned on the host, and anything installed this way is lost
# on rebuild — promote it below the sentinel to keep it.
# RUN echo 'node ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/node \
#   && chmod 0440 /etc/sudoers.d/node

USER node

ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin:/home/node/.local/bin

ENV SHELL=/bin/zsh
ENV EDITOR=mceditor
ENV VISUAL=mceditor

# Default powerlevel10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

RUN echo 'eval "$(pnpm completion zsh)"' >> /home/node/.zshrc

# Claude Code, via the official native installer. Installs to ~/.local/bin, which
# is on PATH above. It self-updates, so this version is only a starting point.
ARG CLAUDE_CODE_VERSION=latest
RUN curl -fsSL https://claude.ai/install.sh | bash -s -- "${CLAUDE_CODE_VERSION}"

# ─── end of claude-shared kit v4 ──────────────────────────────────────────────
# Everything below is yours. `sync-project.sh` replaces everything ABOVE this line
# and never touches anything below it. Keeping project layers last also means the
# shared prefix above stays identical across all your repos, so it comes from
# Docker's layer cache instead of rebuilding.
#
# PROJECT TOOLS — add what this repo needs, then Rebuild Container.
# Only for what npm cannot provide; npm packages (wrangler, vite, playwright,
# drizzle-kit, biome) belong in package.json instead, so their versions travel
# with the repo and with CI.
#
#   USER root
#   RUN apt-get update && apt-get install -y --no-install-recommends \
#         postgresql-client \
#       && apt-get clean && rm -rf /var/lib/apt/lists/*
#   USER node

USER root

# PDF / OCR toolchain used by the `pdf-extract` and `transcribe` skills
# (.claude/skills/pdf-extract, .claude/skills/transcribe).
# poppler-utils: pdftoppm/pdftotext/pdffonts/pdfimages (page-image + text extraction)
# tesseract-ocr + language packs: OCR with hOCR word boxes. eng+swe are installed; add the
# tesseract-ocr-<lang> packs your content needs (and set PDF_EXTRACT_LANGS).
# ocrmypdf: fallback re-OCR / searchable-PDF path
# qpdf: PDF inspect / merge / linearize; poppler's pdfunite merges pages; img2pdf: lossless image->PDF; ghostscript: post-processing
# python3-{reportlab,lxml,pil}: the scripts/hocr_to_pdf.py renderer (page image + invisible corrected text layer -> PDF)
RUN apt-get update && apt-get install -y --no-install-recommends \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-eng \
  tesseract-ocr-swe \
  ocrmypdf \
  qpdf \
  img2pdf \
  ghostscript \
  python3-reportlab \
  python3-lxml \
  python3-pil \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# glotlabs/gdrive — Google Drive source PDFs (`npm run fetch`, sources of type gdrive).
# Releases only ship a linux-x64 binary; on other architectures fetch PDFs outside the container.
# The config dirs are pre-created node-owned so their named volumes (devcontainer.json) are too.
ARG GDRIVE_VERSION=3.9.1
RUN ARCH=$(dpkg --print-architecture) && \
  if [ "$ARCH" = "amd64" ]; then \
    wget "https://github.com/glotlabs/gdrive/releases/download/${GDRIVE_VERSION}/gdrive_linux-x64.tar.gz" -O /tmp/gdrive.tar.gz && \
    tar xzf /tmp/gdrive.tar.gz -C /usr/local/bin gdrive && rm /tmp/gdrive.tar.gz && chmod +x /usr/local/bin/gdrive; \
  else echo "gdrive: no prebuilt binary for $ARCH, skipped" >&2; fi && \
  mkdir -p /home/node/.config/gdrive3 /home/node/.config/publication-md && chown -R node:node /home/node/.config/gdrive3 /home/node/.config/publication-md

USER node
