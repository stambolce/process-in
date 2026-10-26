#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?Missing PORTFOLIO_METADATA_TOKEN}"
# Only opt in public repositories with explicit PROCESS IN attribution in README.
# Existing curated repos are managed by the workflow above.
known='|process-in|rezerv-fitness-management|dentaldesk-practice-management|vetdesk-veterinary-software|assetdesk-it-asset-management|evento-ticketing-platform|coder-ai-website-builder|codehub-developer-platform|toolkit-online-tools|validate-survey-platform|flowing-domain-intelligence|construct-construction-os|inhost-web-hosting|estatespace-real-estate-saas|stambolce|'
failed=0
while IFS= read -r row; do
  name=$(jq -r '.name' <<<"$row")
  visibility=$(jq -r '.visibility' <<<"$row")
  archived=$(jq -r '.archived' <<<"$row")
  [[ "$visibility" == "public" && "$archived" == "false" ]] || continue
  [[ "$known" != *"|$name|"* ]] || continue
  echo "::group::$name"
  if ! readme=$(gh api "repos/stambolce/$name/readme" -H 'Accept: application/vnd.github.raw+json' 2>/dev/null); then
    echo "Skipped: no readable README"; echo "::endgroup::"; continue
  fi
  if ! grep -Eiq 'PROCESS[[:space:]-]+IN' <<<"$readme"; then
    echo "Skipped: no PROCESS IN attribution"; echo "::endgroup::"; continue
  fi
  current=$(gh api "repos/stambolce/$name" 2>/dev/null) || { echo "::warning::$name metadata read failed"; failed=1; echo "::endgroup::"; continue; }
  desc=$(jq -r '.description // ""' <<<"$current")
  if [[ -z "$desc" ]]; then
    # Pick first readable paragraph; skip headings, badges, tables, code and links.
    candidate=$(printf '%s\n' "$readme" | sed 's/\r$//' | awk '
      length($0)>35 && $0 !~ /^[[:space:]]*(#|!|\[|\||<|>|-|\*|\x60)/ {
        gsub(/\[([^]]+)\]\([^)]*\)/,"\\1"); print; exit
      }' | cut -c1-155)
    if [[ -z "$candidate" ]]; then
      echo "Skipped: no suitable description in README"; echo "::endgroup::"; continue
    fi
    if ! gh api -X PATCH "repos/stambolce/$name" -f description="$candidate" >/dev/null; then
      echo "::warning::$name description update failed"; failed=1
    fi
  else
    echo "Preserved existing description"
  fi
  # Add PROCESS IN topic without deleting other topics.
  topics=$(gh api "repos/stambolce/$name/topics" -H 'Accept: application/vnd.github+json' 2>/dev/null) || { echo "::warning::$name topics read failed"; failed=1; echo "::endgroup::"; continue; }
  payload=$(jq -nc --argjson names "$(jq '.names' <<<"$topics")" '{names:(($names + ["process-in"])|unique)}')
  if ! gh api -X PUT "repos/stambolce/$name/topics" -H 'Accept: application/vnd.github+json' --input - <<<"$payload" >/dev/null; then
    echo "::warning::$name topics update failed"; failed=1
  fi
  echo "::endgroup::"
done < <(gh api --paginate "users/stambolce/repos?per_page=100&type=owner" --jq '.[] | @json')
if [[ "$failed" -ne 0 ]]; then echo "::error::Some discovery updates failed"; exit 1; fi
echo "Discovery completed."
