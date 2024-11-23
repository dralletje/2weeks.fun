#!/bin/sh

DIR="$(dirname -- "${BASH_SOURCE[0]}")"
NODE_NO_WARNINGS=1 node --experimental-strip-types --experimental-sqlite "$DIR/run.ts" "$PWD/$1"