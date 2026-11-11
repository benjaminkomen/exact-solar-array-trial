// EAS reads Expo config from here. app.json belongs to Exact (its own schema),
// so this file ignores it and hands EAS only what EAS needs to accept the
// project: a name, slug, owner, bundle id and the EAS project id. Nothing in
// Exact's build reads this file.
module.exports = () => ({
  name: 'Exact Solar Trial',
  slug: 'exact-solar-array-trial',
  owner: 'bkomen',
  version: '0.1.0',
  platforms: ['ios'],
  ios: {
    bundleIdentifier: 'com.bkomen.exact-solar-trial',
    buildNumber: '1',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  extra: { eas: { projectId: 'fa4d862e-9fd7-479d-b15f-b6c13ff60fcc' } },
});
