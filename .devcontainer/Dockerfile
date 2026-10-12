#FROM mcr.microsoft.com/devcontainers/typescript-node:4-24
FROM node:24

ARG TZ
ENV TZ="$TZ"

# Install basic development tools
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
  gh \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  locales \
  mc \
  tmux \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Generate en_US.UTF-8 locale (VSCode forwards LC_ALL=en_US.UTF-8 from the host;
# without this, bash warns "cannot change locale" on every shell invocation)
RUN sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen \
  && locale-gen \
  && update-locale LANG=en_US.UTF-8

# Ensure default node user has access to /usr/local/share/npm-global
RUN mkdir -p /usr/local/share/npm-global/lib /usr/local/share/npm-global/bin && \
  chown -R node:node /usr/local/share/npm-global

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions.
RUN mkdir -p /workspace /home/node/.claude /home/node/.config && \
  chown -R node:node /workspace /home/node/.claude /home/node/.config

WORKDIR /workspace

# Install the PDF / OCR toolchain used by the `pdf-extract` and `transcribe` skills
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
ARG GDRIVE_VERSION=3.9.1
RUN ARCH=$(dpkg --print-architecture) && \
  if [ "$ARCH" = "amd64" ]; then \
    wget "https://github.com/glotlabs/gdrive/releases/download/${GDRIVE_VERSION}/gdrive_linux-x64.tar.gz" -O /tmp/gdrive.tar.gz && \
    tar xzf /tmp/gdrive.tar.gz -C /usr/local/bin gdrive && rm /tmp/gdrive.tar.gz && chmod +x /usr/local/bin/gdrive; \
  else echo "gdrive: no prebuilt binary for $ARCH, skipped" >&2; fi && \
  mkdir -p /home/node/.config/gdrive3 /home/node/.config/publication-md && chown -R node:node /home/node/.config/gdrive3 /home/node/.config/publication-md

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=mceditor
ENV VISUAL=mceditor

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install Claude Code (native installer — script requires bash, not sh/dash)
ENV PATH="/home/node/.local/bin:$PATH"
RUN curl -fsSL https://claude.ai/install.sh | bash
# NOTE:
# Host needs to add this to Preferences: Open Keyboard Shortcuts (JSON) (Ctrl+Shift+P)
#    {
#    "key": "shift+enter",
#    "command": "workbench.action.terminal.sendSequence",
#    "args": {
#        "text": "\u001b\r"
#    },
#    "when": "terminalFocus"
#    }

USER node
