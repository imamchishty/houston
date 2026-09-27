// BDD suite: `npm run bdd`. Features in plain English under features/, steps in features/steps.
export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/**/*.ts', 'features/steps/**/*.ts'],
  format: ['progress', 'summary'],
  strict: true,
};
