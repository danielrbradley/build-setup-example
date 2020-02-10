import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const buildRole = new aws.iam.Role('build-setup-role', {
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'codebuild.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  },
});

new aws.iam.RolePolicyAttachment('build-setup-policy', {
  role: buildRole,
  policyArn: `arn:aws:iam::${aws.getCallerIdentity().accountId}:policy/AdministratorAccess`,
});

const config = new pulumi.Config();

new aws.codebuild.SourceCredential('github-token', {
  authType: 'PERSONAL_ACCESS_TOKEN',
  serverType: 'GITHUB',
  token: config.requireSecret('github-token'),
});

const pulumiAccessToken = new aws.ssm.Parameter('pulumi-access-token', {
  type: 'String',
  value: config.requireSecret('pulumi-access-token'),
});

const buildProject = new aws.codebuild.Project("build-setup", {
  serviceRole: buildRole.arn,
  source: {
    type: "GITHUB",
    location: "https://github.com/danielrbradley/build-setup-example.git"
  },
  environment: {
    type: "LINUX_CONTAINER",
    computeType: "BUILD_GENERAL1_SMALL",
    image: "aws/codebuild/standard:3.0",
    environmentVariables: [
      {
        type: 'PARAMETER_STORE',
        name: 'PULUMI_ACCESS_TOKEN',
        value: pulumiAccessToken.name,
      },
    ],
  },
  artifacts: { type: "NO_ARTIFACTS" }
});

new aws.codebuild.Webhook('build-setup-webhook', {
  projectName: buildProject.name,
  filterGroups: [
    {
      filters: [
        {
          type: 'EVENT',
          pattern: 'PUSH',
        },
        {
          type: 'HEAD_REF',
          pattern: 'refs/heads/master',
        },
      ],
    },
  ],
});
