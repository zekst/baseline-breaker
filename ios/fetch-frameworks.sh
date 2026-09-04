#!/bin/sh
# Downloads the Capacitor 8.5.1 iOS frameworks into the local Swift package (they are not committed to git).
set -e
cd "$(dirname "$0")/App/LocalPackages/capacitor-swift-pm"
mkdir -p Frameworks && cd Frameworks
for n in Capacitor Cordova; do
  curl -sL -o "$n.xcframework.zip" "https://github.com/ionic-team/capacitor-swift-pm/releases/download/8.5.1/$n.xcframework.zip"
  unzip -qo "$n.xcframework.zip" && rm "$n.xcframework.zip"
done
echo "frameworks ready"
