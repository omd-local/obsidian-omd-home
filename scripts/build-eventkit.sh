#!/bin/sh
set -eu

swift build --package-path eventkit-helper -c release
mkdir -p dist
cp eventkit-helper/.build/release/omd-eventkit dist/omd-eventkit
codesign --force --sign - --entitlements eventkit-helper/omd-eventkit.entitlements dist/omd-eventkit
dist/omd-eventkit version
