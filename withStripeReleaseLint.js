const { withProjectBuildGradle } = require('expo/config-plugins');

// Stripe Issuing references a private Google SDK. Omoshow uses PaymentSheet only.
const issuingModule = 'com.stripe:stripe-android-issuing-push-provisioning';
const rule = `
subprojects { subproject ->
    if (subproject.name == 'stripe_stripe-react-native') {
        subproject.dependencies.components.withModule('${issuingModule}') { details ->
            details.allVariants {
                withDependencies { dependencies ->
                    dependencies.removeAll { it.group == 'com.google.android.gms' && it.name == 'play-services-tapandpay' }
                }
            }
        }
    }
}
`;

module.exports = function withStripeReleaseLint(config) {
  return withProjectBuildGradle(config, (project) => {
    if (!project.modResults.contents.includes(rule.trim())) {
      project.modResults.contents += rule;
    }
    return project;
  });
};
