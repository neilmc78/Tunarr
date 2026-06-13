#!/usr/bin/env bash
# =============================================================================
# Tunarr — Proxmox VE LXC Install Script
# Style: community-scripts.org (https://community-scripts.org/)
#
# Run on the Proxmox VE HOST (not inside a container):
#   bash <(curl -fsSL https://raw.githubusercontent.com/neilmc78/Tunarr/main/install/tunarr-lxc.sh)
# =============================================================================
set -Eeuo pipefail
trap 'catch_error $LINENO' ERR

# ── Colours & symbols ────────────────────────────────────────────────────────
YW=$(printf '\033[33m');  BL=$(printf '\033[36m');  RD=$(printf '\033[01;31m')
GN=$(printf '\033[1;92m'); DGN=$(printf '\033[32m'); BGN=$(printf '\033[4;92m')
CL=$(printf '\033[m');    BFR='\r\033[K';            HOLD='  '
CM="${GN}✓${CL}";  CROSS="${RD}✗${CL}";  INFO="${YW}ℹ${CL}"
TAB="  "

# ── App defaults ─────────────────────────────────────────────────────────────
APP="Tunarr"
APP_REPO="https://github.com/neilmc78/Tunarr.git"
APP_PORT="8686"
APP_DIR="/opt/tunarr"
APP_DATA="/opt/tunarr/config"
APP_MUSIC="/mnt/music"
APP_SERVICE="tunarr"

# LXC defaults (user can override interactively)
CT_CPU="2"
CT_RAM="1024"
CT_DISK="8"
CT_OS="debian"
CT_VER="12"
CT_UNPRIVILEGED="1"
CT_HOSTNAME="tunarr"
CT_NET_BRIDGE="vmbr0"
CT_NET_IP="dhcp"          # or e.g. 192.168.1.50/24
CT_NET_GW=""              # only needed for static IP
CT_DNS="1.1.1.1"
CT_STORAGE="local-lvm"    # override with your preferred storage

# SSH / credentials (set during configure)
CT_SSH_ENABLE=0
CT_ROOT_PW=""

# ── Helpers ───────────────────────────────────────────────────────────────────
catch_error() {
  printf "\n${RD}[ERROR]${CL} Install failed at line %s. Check output above.\n" "$1"
  exit 1
}

header_info() {
  clear
  cat <<'EOF'
  _____ 
 /__   \ _   _ _ __   __ _ _ __ _ __ 
   / /\/ | | | | '_ \ / _` | '__| '__|
  / /  | |_| | | | | (_| | |  | |   
  \/    \__,_|_| |_|\__,_|_|  |_|   

EOF
  printf "${BL}  Individual music track download manager${CL}\n"
  printf "${DGN}  Sonarr-style · MusicBrainz · yt-dlp · FastAPI${CL}\n\n"
}

msg_info()  { printf " ${HOLD} ${YW}%-55s${CL}" "$1"; }
msg_ok()    { printf "${BFR} ${CM} ${DGN}%s${CL}\n"    "$1"; }
msg_error() { printf "${BFR} ${CROSS} ${RD}%s${CL}\n"  "$1"; }

ask() {
  local var=$1 prompt=$2 default=$3
  read -rp "  ${BL}${prompt}${CL} [${DGN}${default}${CL}]: " input
  eval "${var}=\"${input:-$default}\""
}

ask_yn() {
  local prompt=$1 default=${2:-n}
  read -rp "  ${BL}${prompt}${CL} [${DGN}${default}${CL}]: " input
  input=${input:-$default}
  [[ "${input,,}" =~ ^y ]]
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
check_pve() {
  if ! command -v pct &>/dev/null; then
    printf "\n${RD}[ERROR]${CL} This script must be run on a Proxmox VE host.\n"
    exit 1
  fi
  local pve_major
  pve_major=$(pveversion | grep -oP '(?<=pve-manager/)\d+' | head -1)
  if [[ "${pve_major}" -lt 7 ]]; then
    printf "\n${RD}[ERROR]${CL} Proxmox VE 7+ required (detected %s).\n" "${pve_major}"
    exit 1
  fi
}

get_next_ctid() {
  pvesh get /cluster/nextid 2>/dev/null || echo "200"
}

get_template() {
  local tmpl_store="local"

  msg_info "Updating Proxmox template list"
  pveam update >/dev/null 2>&1 || true
  msg_ok "Template list updated"

  msg_info "Finding latest Debian 12 template"
  local tmpl
  tmpl=$(pveam available --section system 2>/dev/null \
    | awk '/debian-12-standard/{print $2}' \
    | sort -V \
    | tail -1)

  if [[ -z "${tmpl}" ]]; then
    msg_error "No Debian 12 template found — run: pveam update && pveam available --section system"
    exit 1
  fi
  msg_ok "Found template: ${tmpl}"

  local tmpl_path="/var/lib/vz/template/cache/${tmpl}"
  if [[ ! -f "${tmpl_path}" ]]; then
    msg_info "Downloading ${tmpl}"
    if ! pveam download "${tmpl_store}" "${tmpl}" >/dev/null 2>&1; then
      msg_error "Template download failed — check network and run: pveam available --section system"
      exit 1
    fi
    msg_ok "Template downloaded"
  else
    msg_ok "Template already present"
  fi

  TEMPLATE="${tmpl_store}:vztmpl/${tmpl}"
}

# ── Interactive configuration ─────────────────────────────────────────────────
configure() {
  printf "\n${BL}Container settings (press Enter to accept defaults):${CL}\n\n"

  ask CT_HOSTNAME   "Hostname"                           "${CT_HOSTNAME}"
  ask CTID          "Container ID"                       "$(get_next_ctid)"
  ask CT_CPU        "CPU cores"                          "${CT_CPU}"
  ask CT_RAM        "RAM (MB)"                           "${CT_RAM}"
  ask CT_DISK       "Disk size (GB)"                     "${CT_DISK}"
  ask CT_STORAGE    "Storage pool"                       "${CT_STORAGE}"
  ask CT_NET_BRIDGE "Network bridge"                     "${CT_NET_BRIDGE}"
  ask CT_NET_IP     "IP (dhcp or x.x.x.x/nn)"           "${CT_NET_IP}"
  if [[ "${CT_NET_IP}" != "dhcp" ]]; then
    ask CT_NET_GW   "Gateway"                            "${CT_NET_GW}"
  fi
  ask APP_MUSIC     "Music library path on host"         "${APP_MUSIC}"

  printf "\n${BL}SSH access:${CL}\n\n"
  if ask_yn "Enable SSH (allows remote login to container)?" "y"; then
    CT_SSH_ENABLE=1
    while true; do
      read -rsp "  ${BL}Root password:${CL} " CT_ROOT_PW; printf "\n"
      if [[ -z "${CT_ROOT_PW}" ]]; then
        printf "  ${CROSS} ${RD}Password cannot be empty.${CL}\n"
        continue
      fi
      read -rsp "  ${BL}Confirm password:${CL} " _pw2; printf "\n"
      if [[ "${CT_ROOT_PW}" != "${_pw2}" ]]; then
        printf "  ${CROSS} ${RD}Passwords do not match — try again.${CL}\n"
        continue
      fi
      break
    done
    printf "  ${CM} ${DGN}Password set${CL}\n"
  else
    CT_SSH_ENABLE=0
    printf "  ${INFO} ${DGN}SSH skipped — use: pct enter <CTID>${CL}\n"
  fi

  printf "\n"
  printf "  ${INFO} Summary:\n"
  printf "  ${TAB}CT ID       : ${GN}%s${CL}\n"  "${CTID}"
  printf "  ${TAB}Hostname    : ${GN}%s${CL}\n"  "${CT_HOSTNAME}"
  printf "  ${TAB}CPU / RAM   : ${GN}%s cores / %s MB${CL}\n" "${CT_CPU}" "${CT_RAM}"
  printf "  ${TAB}Disk        : ${GN}%s GB on %s${CL}\n"  "${CT_DISK}" "${CT_STORAGE}"
  printf "  ${TAB}Network     : ${GN}%s / %s${CL}\n"  "${CT_NET_BRIDGE}" "${CT_NET_IP}"
  printf "  ${TAB}Music path  : ${GN}%s${CL}\n"  "${APP_MUSIC}"
  if [[ "${CT_SSH_ENABLE}" == "1" ]]; then
    printf "  ${TAB}SSH         : ${GN}enabled (root login)${CL}\n"
  else
    printf "  ${TAB}SSH         : ${DGN}disabled${CL}\n"
  fi
  printf "\n"

  if ! ask_yn "Proceed with install?" "y"; then
    printf "  Aborted.\n"
    exit 0
  fi
}

# ── Create LXC container ──────────────────────────────────────────────────────
create_container() {
  get_template

  msg_info "Creating LXC container ${CTID}"

  local net="name=eth0,bridge=${CT_NET_BRIDGE}"
  if [[ "${CT_NET_IP}" == "dhcp" ]]; then
    net+=",ip=dhcp"
  else
    net+=",ip=${CT_NET_IP}"
    [[ -n "${CT_NET_GW}" ]] && net+=",gw=${CT_NET_GW}"
  fi

  pct create "${CTID}" "${TEMPLATE}" \
    --hostname   "${CT_HOSTNAME}" \
    --cores      "${CT_CPU}" \
    --memory     "${CT_RAM}" \
    --rootfs     "${CT_STORAGE}:${CT_DISK}" \
    --net0       "${net}" \
    --nameserver "${CT_DNS}" \
    --unprivileged "${CT_UNPRIVILEGED}" \
    --features   "nesting=1" \
    --ostype     "${CT_OS}" \
    --start      0 \
    &>/dev/null

  if [[ -n "${APP_MUSIC}" ]]; then
    mkdir -p "${APP_MUSIC}"
    pct set "${CTID}" --mp0 "${APP_MUSIC},mp=/mnt/music" &>/dev/null
  fi

  msg_ok "Container ${CTID} created"

  msg_info "Starting container"
  pct start "${CTID}" &>/dev/null
  sleep 3
  msg_ok "Container started"
}

# ── Run install inside container ──────────────────────────────────────────────
install_tunarr() {
  msg_info "Installing dependencies (this takes a minute)"
  pct exec "${CTID}" -- bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
      curl git ffmpeg python3 python3-pip python3-venv \
      ca-certificates locales openssh-server nodejs &>/dev/null
  ' &>/dev/null
  msg_ok "System packages installed"

  msg_info "Cloning Tunarr repository"
  pct exec "${CTID}" -- bash -c "
    git clone --depth 1 '${APP_REPO}' '${APP_DIR}' &>/dev/null
  " &>/dev/null
  msg_ok "Repository cloned"

  msg_info "Installing Python dependencies"
  pct exec "${CTID}" -- bash -c "
    python3 -m venv '${APP_DIR}/venv'
    '${APP_DIR}/venv/bin/pip' install --quiet --upgrade pip
    '${APP_DIR}/venv/bin/pip' install --quiet -r '${APP_DIR}/requirements.txt'
  " &>/dev/null
  msg_ok "Python dependencies installed"

  msg_info "Creating directories and systemd service"
  pct exec "${CTID}" -- bash -c "
    mkdir -p '${APP_DATA}' '/mnt/music'

    cat > /etc/systemd/system/${APP_SERVICE}.service <<'UNIT'
[Unit]
Description=Tunarr — individual music track download manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
Environment=TUNARR_DATA_DIR=${APP_DATA}
Environment=TUNARR_MUSIC_DIR=/mnt/music
ExecStart=${APP_DIR}/venv/bin/uvicorn src.main:app --host 0.0.0.0 --port ${APP_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

    systemctl daemon-reload &>/dev/null
    systemctl enable --now ${APP_SERVICE} &>/dev/null
  "
  msg_ok "Tunarr service enabled and started"

  if [[ "${CT_SSH_ENABLE}" == "1" ]]; then
    msg_info "Configuring SSH access"
    pct exec "${CTID}" -- bash -c '
      sed -i "/^#\?PermitRootLogin/c\PermitRootLogin yes" /etc/ssh/sshd_config
      sed -i "/^#\?PasswordAuthentication/c\PasswordAuthentication yes" /etc/ssh/sshd_config
      systemctl enable --now ssh &>/dev/null || systemctl enable --now sshd &>/dev/null || true
    '
    printf 'root:%s' "${CT_ROOT_PW}" | pct exec "${CTID}" -- chpasswd
    msg_ok "SSH enabled — root login with password"
  fi

  msg_info "Setting up login banner"
  pct exec "${CTID}" -- bash -c '
    # Clear the static Debian legal notice
    truncate -s 0 /etc/motd
    # Silence the default kernel version line
    chmod -x /etc/update-motd.d/10-uname 2>/dev/null || true

    cat > /etc/update-motd.d/01-tunarr <<'"'"'MOTDEOF'"'"'
#!/usr/bin/env bash
OS=$(. /etc/os-release && printf "%s - Version: %s" "${NAME}" "${VERSION_ID}")
HOSTNAME=$(hostname)
IP=$(ip -4 addr show eth0 2>/dev/null | grep -oP "(?<=inet )\S+" | cut -d/ -f1 || echo "unknown")
SVC=$(systemctl is-active tunarr 2>/dev/null || echo unknown)
GN="\033[1;92m"; YW="\033[33m"; DGN="\033[32m"; BL="\033[36m"; CL="\033[m"
printf "\n"
printf "${GN}  Tunarr LXC Container${CL}\n"
printf "  ${BL}\xf0\x9f\x8c\x90  GitHub: https://github.com/neilmc78/Tunarr${CL}\n\n"
printf "  ${YW}\xf0\x9f\x92\xbb  OS      :${CL} %s\n" "${OS}"
printf "  ${YW}\xf0\x9f\x8f\xa0  Hostname:${CL} %s\n" "${HOSTNAME}"
printf "  ${YW}\xf0\x9f\x92\xa1  IP      :${CL} %s\n" "${IP}"
printf "  ${YW}\xf0\x9f\x8e\xb5  Service :${CL} tunarr is %s\n" "${SVC}"
printf "\n"
MOTDEOF
    chmod +x /etc/update-motd.d/01-tunarr
  '
  msg_ok "Login banner configured"
}

# ── Post-install info ─────────────────────────────────────────────────────────
print_completion() {
  local ip
  ip=$(pct exec "${CTID}" -- bash -c \
    "ip -4 addr show eth0 | grep -oP '(?<=inet )\\S+' | cut -d/ -f1" 2>/dev/null || true)
  [[ -z "${ip}" ]] && ip="<container-ip>"

  printf "\n${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}\n"
  printf "  ${CM} ${GN}Tunarr installed successfully!${CL}\n\n"
  printf "  ${INFO} ${YW}Web UI :${CL}  ${BGN}http://%s:%s${CL}\n"       "${ip}" "${APP_PORT}"
  printf "  ${INFO} ${YW}CT ID  :${CL}  %s\n"                             "${CTID}"
  printf "  ${INFO} ${YW}Music  :${CL}  %s (→ /mnt/music inside CT)\n"   "${APP_MUSIC}"
  printf "  ${INFO} ${YW}Config :${CL}  %s (inside CT)\n"                "${APP_DATA}"
  if [[ "${CT_SSH_ENABLE}" == "1" ]]; then
    printf "  ${INFO} ${YW}SSH    :${CL}  ssh root@%s\n"                  "${ip}"
  fi
  printf "\n  ${YW}First steps:${CL}\n"
  printf "  ${TAB}1. Open http://%s:%s\n"            "${ip}" "${APP_PORT}"
  printf "  ${TAB}2. Settings → Add Root Folder → /mnt/music\n"
  printf "  ${TAB}3. Artists → Add Artist\n"
  printf "\n  ${DGN}Logs :${CL}  pct exec %s -- journalctl -u tunarr -f\n" "${CTID}"
  printf "  ${DGN}Shell:${CL}  pct enter %s\n"                            "${CTID}"
  printf "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}\n\n"
}

# ── Update helper (run inside the CT) ────────────────────────────────────────
# Usage: pct exec <CTID> -- bash /opt/tunarr/install/tunarr-lxc.sh update
if [[ "${1:-}" == "update" ]]; then
  printf "${YW}Updating Tunarr…${CL}\n"
  systemctl stop tunarr
  git -C "${APP_DIR}" pull --ff-only
  "${APP_DIR}/venv/bin/pip" install --quiet --upgrade pip
  "${APP_DIR}/venv/bin/pip" install --quiet --upgrade yt-dlp
  "${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"
  systemctl start tunarr
  printf "${GN}✓ Tunarr updated and restarted.${CL}\n"
  exit 0
fi

# ── Main ──────────────────────────────────────────────────────────────────────
header_info
check_pve
configure
create_container
install_tunarr
print_completion
