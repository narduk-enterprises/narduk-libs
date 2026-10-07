# Beat Blaster UI smoke suite

Fast, identifier-based XCUITests: one simulator (iPhone 17 Pro), `-silent YES`
so nothing plays aloud, about two minutes.

| Test                                      | Flow                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `testMakeASongPlayDropAndGoHome`          | Home, Make a Song, the maker steps, the player, open the controls tray, DROP press and release, Home                       |
| `testRecordSaveRenameAndShareFromMySongs` | record in the player, Home, My Songs shows the song, rename it, the share sheet appears (dismissing it is not covered yet) |

Run (never opens Simulator.app; from
`packages/modules/narduk-music/swift/Apps/BeatBlaster`):

```sh
xcodegen generate
~/.local/share/agent-infrastructure/skills/apple-release-pipeline/scripts/xcodebuild_leased.sh \
  test -project BeatBlaster.xcodeproj -scheme BeatBlaster -only-testing:BeatBlasterUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Selectors are accessibility identifiers (`home.makeSong`, `maker.title`,
`player.root`, `player.tray.handle`, `player.tray`, `player.drop`, `player.rec`,
`player.home`, `home.mySongs`, `mysongs.row`, `mysongs.rename`, `mysongs.play`,
`mysongs.share`, `mysongs.home`). Add an identifier in the app before adding a
test that needs one; do not select by position.
