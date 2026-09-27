// BDD suite: `npm run bdd`. Features in plain English under features/, steps in features/steps.
export default {
  paths: ['features/**/*.feature'],
  import: ['features/support/**/*.ts', 'features/steps/**/*.ts'],
  // reports/cucumber.json feeds the test report on the admin page (npm run report)
  format: ['progress', 'summary', 'json:reports/cucumber.json'],
  strict: true,
};
