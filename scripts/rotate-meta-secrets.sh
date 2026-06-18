#!/usr/bin/env bash
#
# rotate-meta-secrets.sh
# -----------------------
# Rotate the Meta-platform OAuth credentials in Google Cloud Secret Manager to
# the new app:  "Markaestro"  (App ID 1645694433302285, Aethos Solutions).
#
# These six secrets are read at runtime by Firebase App Hosting (see
# apphosting.yaml). App IDs are NOT sensitive and are written directly; the
# three App Secrets are entered interactively (hidden, double-entry confirmed)
# so they never touch disk or your shell history.
#
# RUN THIS ON YOUR OWN MACHINE — not in the sandbox — where gcloud/firebase
# are authenticated to the markaestro project.
#
#   Prereqs : gcloud CLI authenticated  (gcloud auth login)
#             Secret Manager Admin (or secretmanager.versions.{add,access})
#             optional: firebase CLI for the App Hosting rollout step
#
#   Usage   : bash scripts/rotate-meta-secrets.sh [options]
#
#   Options : --project ID   Override the GCP project (default below)
#             --dry-run      Run all preflight checks and print the plan; change nothing
#             --no-rollout   Skip the optional Firebase App Hosting rollout prompt
#             --yes          Don't pause for the final confirmation prompt
#             -h | --help    Show this help
#
# Old secret versions are left untouched so you can roll back by copying a
# prior version into a new latest version.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT="markaestro-0226220726"

# Ordered list of the secrets to rotate.
SECRET_NAMES=(
  META_APP_ID
  META_APP_SECRET
  INSTAGRAM_APP_ID
  INSTAGRAM_APP_SECRET
  THREADS_APP_ID
  THREADS_APP_SECRET
)

DRY_RUN=0
DO_ROLLOUT=1
ASSUME_YES=0

# ---------------------------------------------------------------------------
# Pretty output (no colour if not a TTY)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_BOLD=""
fi
info () { printf '%s\n' "${C_BLU}•${C_RESET} $*"; }
ok   () { printf '%s\n' "${C_GRN}✓${C_RESET} $*"; }
warn () { printf '%s\n' "${C_YEL}!${C_RESET} $*" >&2; }
err  () { printf '%s\n' "${C_RED}✗${C_RESET} $*" >&2; }
die  () { err "$*"; exit 1; }
hr   () { printf '%s\n' "------------------------------------------------------------"; }

usage () { sed -n '2,40p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'; exit 0; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Expected (non-secret) value for an App ID, or empty for a secret.
expected_id_value () {
  case "$1" in
    META_APP_ID)      printf '%s' "1645694433302285" ;;
    INSTAGRAM_APP_ID) printf '%s' "916172414583238" ;;
    THREADS_APP_ID)   printf '%s' "1493496502304419" ;;
    *)                printf '' ;;
  esac
}

# Is this secret an App ID (non-sensitive) rather than an App Secret?
is_app_id () { case "$1" in *_APP_ID) return 0 ;; *) return 1 ;; esac; }

# Where to reveal a given App Secret in the Meta portal.
reveal_hint () {
  case "$1" in
    META_APP_SECRET)      printf '%s' "App settings ▸ Basic ▸ App secret ▸ Show" ;;
    INSTAGRAM_APP_SECRET) printf '%s' "Use cases ▸ Instagram API ▸ API setup with Instagram login ▸ Instagram app secret ▸ Show" ;;
    THREADS_APP_SECRET)   printf '%s' "Use cases ▸ Access the Threads API ▸ Settings ▸ Threads app secret ▸ Show" ;;
    *)                    printf '%s' "the Meta developer portal" ;;
  esac
}

# Pick an available SHA-256 tool.
sha_cmd () {
  if command -v shasum  >/dev/null 2>&1; then echo "shasum -a 256";
  elif command -v sha256sum >/dev/null 2>&1; then echo "sha256sum";
  else echo ""; fi
}
checksum () { # reads stdin -> prints hex digest (or empty if no tool)
  local c; c="$(sha_cmd)"
  [ -n "$c" ] || { echo ""; return; }
  $c | awk '{print $1}'
}

# Current "latest" enabled version number for a secret (empty if none).
current_version () {
  gcloud secrets versions describe latest \
    --secret="$1" --project="$PROJECT" \
    --format='value(name)' 2>/dev/null | awk -F/ '{print $NF}'
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?--project needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-rollout) DO_ROLLOUT=0; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
hr; printf '%s\n' "${C_BOLD}Meta secret rotation — preflight${C_RESET}"; hr

command -v gcloud >/dev/null 2>&1 || die "gcloud CLI not found. Install the Google Cloud SDK first."
ok "gcloud found: $(command -v gcloud)"

ACTIVE_ACCT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[ -n "$ACTIVE_ACCT" ] || die "No active gcloud account. Run: gcloud auth login"
ok "Authenticated as: $ACTIVE_ACCT"

gcloud projects describe "$PROJECT" >/dev/null 2>&1 \
  || die "Cannot access project '$PROJECT' (wrong project, or account lacks access)."
ok "Project reachable: $PROJECT"

[ -n "$(sha_cmd)" ] || warn "No shasum/sha256sum found — write-verification by checksum will be skipped."

# Confirm every secret already exists (we add versions, we don't create).
info "Checking that all six secrets exist…"
MISSING=""
for name in "${SECRET_NAMES[@]}"; do
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    printf '   %s %s (current latest: v%s)\n' "${C_GRN}✓${C_RESET}" "$name" "$(current_version "$name" || echo '?')"
  else
    printf '   %s %s — NOT FOUND\n' "${C_RED}✗${C_RESET}" "$name"
    MISSING="$MISSING $name"
  fi
done
[ -z "$MISSING" ] || die "These secrets don't exist in '$PROJECT':$MISSING. Create them first (e.g. firebase apphosting:secrets:set NAME) or fix the project."

if [ "$DRY_RUN" -eq 1 ]; then
  hr; ok "Dry run complete. Preflight passed; no changes made."
  info "Re-run without --dry-run to rotate the secrets."
  exit 0
fi

# ---------------------------------------------------------------------------
# Collect values
# ---------------------------------------------------------------------------
hr; printf '%s\n' "${C_BOLD}Collecting new values${C_RESET}"; hr
info "App IDs are filled in automatically. For each App Secret, reveal it in the"
info "portal and paste it (input hidden; you'll enter each twice to confirm)."
echo

# Parallel array to hold the value for each secret (indexed like SECRET_NAMES).
VALUES=()
for name in "${SECRET_NAMES[@]}"; do
  if is_app_id "$name"; then
    VALUES+=("$(expected_id_value "$name")")
    continue
  fi

  # Secret: double-entry, non-empty, no surrounding whitespace.
  while :; do
    printf '%s\n' "${C_BOLD}$name${C_RESET}  ($(reveal_hint "$name"))"
    s1=""; s2=""
    read -rsp "  paste secret : " s1; echo
    read -rsp "  re-enter     : " s2; echo
    if [ "$s1" != "$s2" ]; then warn "Entries did not match — try again."; echo; continue; fi
    if [ -z "$s1" ]; then warn "Empty value — try again."; echo; continue; fi
    case "$s1" in *[[:space:]]*) warn "Value contains whitespace — paste without spaces/newlines."; echo; continue ;; esac
    # Soft format check: Meta app secrets are typically 32 hex chars.
    if ! printf '%s' "$s1" | grep -Eq '^[A-Za-z0-9]{20,64}$'; then
      printf '   %s value looks unusual (expected ~32 alphanumerics). Use it anyway? [y/N] ' "${C_YEL}!${C_RESET}"
      read -r ans </dev/tty || ans=""
      case "$ans" in y|Y) : ;; *) echo; continue ;; esac
    fi
    VALUES+=("$s1")
    break
  done
  echo
done

# ---------------------------------------------------------------------------
# Final confirmation
# ---------------------------------------------------------------------------
hr; printf '%s\n' "${C_BOLD}Ready to write new versions in: $PROJECT${C_RESET}"; hr
for i in "${!SECRET_NAMES[@]}"; do
  name="${SECRET_NAMES[$i]}"
  if is_app_id "$name"; then disp="${VALUES[$i]}"; else disp="•••••• (hidden)"; fi
  printf '   %-22s -> %s\n' "$name" "$disp"
done
echo
if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Proceed? [y/N] '
  read -r go </dev/tty || go=""
  case "$go" in y|Y) : ;; *) die "Aborted; nothing changed." ;; esac
fi

# ---------------------------------------------------------------------------
# Apply + verify
# ---------------------------------------------------------------------------
hr; printf '%s\n' "${C_BOLD}Applying${C_RESET}"; hr
FAIL=0
SUMMARY=""
for i in "${!SECRET_NAMES[@]}"; do
  name="${SECRET_NAMES[$i]}"
  value="${VALUES[$i]}"
  old_ver="$(current_version "$name" || true)"

  # Add a new version with NO trailing newline.
  new_ref="$(printf '%s' "$value" | gcloud secrets versions add "$name" \
               --data-file=- --project="$PROJECT" --format='value(name)' 2>/dev/null || true)"
  new_ver="$(printf '%s' "$new_ref" | awk -F/ '{print $NF}')"

  if [ -z "$new_ver" ]; then
    err "$name: failed to add a new version."
    SUMMARY="$SUMMARY\n  ✗ $name (old v${old_ver:-?}) — ADD FAILED"
    FAIL=1
    continue
  fi

  # Verify by reading the value back and comparing checksums (never printed).
  verify="skipped"
  if [ -n "$(sha_cmd)" ]; then
    want="$(printf '%s' "$value" | checksum)"
    got="$(gcloud secrets versions access "$new_ver" --secret="$name" --project="$PROJECT" 2>/dev/null | checksum)"
    if [ -n "$got" ] && [ "$want" = "$got" ]; then verify="verified"; else verify="MISMATCH"; FAIL=1; fi
  fi

  if [ "$verify" = "MISMATCH" ]; then
    err "$name: written but read-back checksum did NOT match."
    SUMMARY="$SUMMARY\n  ✗ $name  v${old_ver:-?} -> v$new_ver  (verify: MISMATCH)"
  else
    ok "$name  v${old_ver:-none} -> v$new_ver  ($verify)"
    SUMMARY="$SUMMARY\n  ✓ $name  v${old_ver:-none} -> v$new_ver  ($verify)"
  fi
done

hr; printf '%s\n' "${C_BOLD}Summary${C_RESET}"; hr
printf '%b\n' "$SUMMARY"

if [ "$FAIL" -ne 0 ]; then
  echo
  err "One or more secrets failed. Old versions are untouched."
  warn "Roll back a secret if needed:"
  warn "  gcloud secrets versions list  NAME --project=$PROJECT"
  warn "  gcloud secrets versions enable OLD_VERSION --secret=NAME --project=$PROJECT  # if it was disabled"
  exit 1
fi

echo
ok "All six secrets rotated and verified."
info "Old versions are retained. To roll a secret back to a prior version, add"
info "a new version from it, e.g.:"
info "  gcloud secrets versions access OLD_VER --secret=NAME --project=$PROJECT \\"
info "    | gcloud secrets versions add NAME --data-file=- --project=$PROJECT"

# ---------------------------------------------------------------------------
# Optional: trigger a Firebase App Hosting rollout so runtime picks up changes
# ---------------------------------------------------------------------------
echo
if [ "$DO_ROLLOUT" -eq 1 ]; then
  if command -v firebase >/dev/null 2>&1; then
    info "App Hosting reads these at deploy time, so a rollout is needed for prod to use the new values."
    printf 'List App Hosting backends and create a rollout now? [y/N] '
    read -r rr </dev/tty || rr=""
    case "$rr" in
      y|Y)
        firebase apphosting:backends:list --project "$PROJECT" || warn "Could not list backends."
        printf 'Backend ID to roll out (blank to skip): '
        read -r backend </dev/tty || backend=""
        if [ -n "$backend" ]; then
          firebase apphosting:rollouts:create "$backend" --project "$PROJECT" \
            && ok "Rollout created for '$backend'." \
            || warn "Rollout command failed — create one from the Firebase console instead."
        else
          info "Skipped rollout."
        fi
        ;;
      *) info "Skipped rollout. Trigger one later via a deploy or 'firebase apphosting:rollouts:create <BACKEND>'." ;;
    esac
  else
    warn "firebase CLI not found — skipping rollout."
    info "Trigger a rollout later (deploy, or 'firebase apphosting:rollouts:create <BACKEND>') so prod uses the new secrets."
  fi
fi

echo
ok "Done."
