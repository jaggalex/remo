#!/usr/bin/env bash
# Release configuration: read and validate a private KEY=VALUE file as data.
#
# Sourced by `release.sh` and kept in its own file so the rules can be exercised
# without starting a release. Nothing here evaluates the file: `source` would turn a
# document the script merely reads into shell code and could change the environment the
# verification gate sees.

release_file_uid() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"; }
release_file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Print why a configuration file may not be used, and return 1. Silent when it may.
check_release_config() {
  local file=$1
  [[ ! -L $file ]] || {
    echo "Refusing a symlinked release configuration: $file" >&2
    return 1
  }
  [[ -f $file && -r $file ]] || {
    echo "Cannot read release configuration: $file" >&2
    return 1
  }
  [[ $(release_file_uid "$file") == "$(id -u)" ]] || {
    echo "Release configuration must be owned by the current user: $file" >&2
    return 1
  }
  [[ $(release_file_mode "$file") == "600" ]] || {
    echo "Release configuration must be mode 600 (chmod 600 $file)." >&2
    return 1
  }
}

# Assign REMO_DEPLOY_HOST, REMO_APP_ORIGIN and REMO_DOCS_ORIGIN from strict
# `KEY=VALUE` lines. Blank lines and `#` comments are allowed; anything else is an
# error, so a typo cannot be silently ignored.
read_release_config() {
  local file=$1 line key value
  check_release_config "$file" || return 1
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z $line || $line == \#* ]] && continue
    [[ $line =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || {
      echo "Invalid line in $file (expected KEY=VALUE): $line" >&2
      return 1
    }
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    # Values are used as arguments, never evaluated, so shell syntax is a mistake
    # rather than a feature.
    [[ $value == *'$('* || $value == *'`'* ]] && {
      echo "Shell syntax is not allowed in $file: $line" >&2
      return 1
    }
    case $key in
      REMO_DEPLOY_HOST|REMO_APP_ORIGIN|REMO_DOCS_ORIGIN) printf -v "$key" '%s' "$value" ;;
      *)
        echo "Unknown key in $file: $key" >&2
        return 1
        ;;
    esac
  done < "$file"
}

# Render the app's security headers with the one support origin allowed to be framed.
#
# `add_header` is static: nginx cannot substitute a variable into a CSP at request time,
# so the alternative is one rendered file per installation (ADR-250). The origin is
# validated here rather than at the first blocked iframe, and only `__SUPPORT_ORIGIN__`
# in the template is replaced — sed never sees the rest of the policy.
render_support_headers() {
  local origin=$1 output=$2 template directory
  [[ $origin =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || {
    echo "Support origin must be https://host[:port] without a path: $origin" >&2
    return 1
  }
  directory=$(dirname -- "$output")
  [[ -d $directory ]] || {
    echo "Cannot write rendered headers: no directory $directory" >&2
    return 1
  }
  template="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx-security-headers-support.conf"
  [[ -f $template ]] || {
    echo "Cannot read template: $template" >&2
    return 1
  }
  sed "s|__SUPPORT_ORIGIN__|$origin|g" "$template" > "$output.tmp.$$" &&
    mv -f -- "$output.tmp.$$" "$output"
}
