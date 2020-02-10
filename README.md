# Replacing Build Servers With Pulumi + AWS

Tired of restarting your Jenkins box because something's broken?<br />Don't like configuring your builds using a slow web UI?<br />_Ditch your flaky Jenkins box and use AWS CodeBuild configured via Pulumi!_

Here's the plan, it's a little inception-y, so hang tight...

1. Create a GitHub repository
2. Describe an AWS CodeBuild project using TypeScript that will watch itself
3. Deploy the the infrastructure using Pulumi
4. Watch it deploy itself as we push changes!

![Yo dawg I heard you liked CodeBuild, so I built CodeBuild in CodeBuild so you can configure your CodeBuild projects via CodeBuild](https://dev-to-uploads.s3.amazonaws.com/i/ye4d0tk9ghgcdc7cxmnl.jpeg)

Don't panic, it should become clearer as we get into the code!

## Introducing The Tools

**[AWS CodeBuild](https://aws.amazon.com/codebuild/)** - _Build and test code with continuous scaling. Pay only for the build time you use._

CodeBuild is very similar to many other build services available but has the added benefit of being tightly integrated into the AWS ecosystem e.g. billing, permissions, automation.

We'll also be using the AWS CLI, so [go install that](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html) if you've not already got it.

**[Pulumi](https://www.pulumi.com)** - _Modern infrastructure as code using real languages._

Sign up for an account - it's free to use for personal use. The account will manage the state of your project deployments.

I'll be using TypeScript here, but you're also able to use a number of other polular languages to achive the same result with Pulumi.

## Pulumi Project Setup

Follow through the Pulumi [getting started guide for AWS](https://www.pulumi.com/docs/get-started/aws/) to install the CLI tools, configure your environment and create a blank `aws-typescript` project called `build-setup`.

**Note:** As an example we'll pretend we're pushing it to GitHub at `https://github.com/danielrbradley/build-setup`.

You should now have an `index.ts` file with something that looks like this.

```ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("my-bucket");

// Export the name of the bucket
export const bucketName = bucket.id;
```

## The First CodeBuild Project

Delete the lines that created the S3 bucket and exported the name of the bucket - we don't need them.

Here's what we need to setup a CodeBuild project:

```ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const buildProject = new aws.codebuild.Project('build-setup', {
  serviceRole: 'TODO',
  source: {
    type: 'GITHUB',
    location: 'https://github.com/danielrbradley/build-setup.git',
  },
  environment: {
    type: 'LINUX_CONTAINER',
    computeType: 'BUILD_GENERAL1_SMALL',
    image: 'aws/codebuild/standard:3.0',
  },
  artifacts: { type: 'NO_ARTIFACTS' },
});
```

Let's break this down line-by-line:

1. `const buildProject = new aws.codebuild.Project('build-setup'`
   This creates us a new Pulumi resource representing a CodeBuild project. Creating this doesn't immediately create the resource in AWS but describes to Pulumi what we will want to deploy in the future.
2. `serviceRole: 'TODO'` We'll skip over this right now and fix it below.
3. `source: {...}` - where should CodeBuild get the source code to build? We're using GitHub, but you can also use other sources too.
4. `environment: {...}` What kind of computer do you need for running your build - Linux or Windows, small & cheap or more powerful, the operating system (a docker image)
5. `artifacts` Where should any output files be written? This first build won't have any.

## Permissions

Back to that `serviceRole` property. When the build is run, the role we specify here defines what in our AWS account is made accessed to the build job. Because we're running the build inside AWS, we don't need to use access keys, it inherits all the access of the role.

Create a new role for your build to run as. Add this before your CodeBuild project.

```ts
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
```

This defines a role to be created and specifies through the "assume role policy" that only the CodeBuild service is allowed to use this role.

Now, we need to specify what CodeBuild will be allowed to do when acting as this role. There's two ways we can do this: define our own "inline policy" listing specific services, actions and resources; or attach an existing policy to the role. Here we'll go for the latter:

```ts
new aws.iam.RolePolicyAttachment('build-setup-policy', {
  role: buildRole,
  policyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
});
```

> **Important note:** To keep the example simple and concise, we're just going to give the role administrator access. I would exercise caution in using this exact approach as it means that anyone who can pushes code to your GitHub repository can change absolutely anything in your AWS account.

Reading line-by-line:

1. `new aws.iam.RolePolicyAttachment('build-setup-policy'`
   We're creating a resource which 'attaches' a policy to a role and giving that attachment the name `build-setup-policy`.
2. `role: buildRole,` The role you want to attach to - which is the role created in the previous step. This can either be a role object or a string containing a role [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html).
3. `policyArn: ...` The [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) string of the policy to attach. `AdministratorAccess` is an AWS managed, built-in policy giving complete unrestricted access to your AWS account.

Now update your `buildProject`, `serviceRole` property to point to your new `buildRole`'s `arn`:

```ts
const buildProject = new aws.codebuild.Project("build-setup", {
  serviceRole: buildRole.arn,
  //---------- SNIP ----------//
});
```

## Authenticating CodeBuild with GitHub

Go to GitHub and [create a "personal access token"](https://help.github.com/en/github/authenticating-to-github/creating-a-personal-access-token-for-the-command-line). When creating the token, you'll need to tick the `repo` and `admin:repo_hook` scopes.

Pulumi has built-in configuration and even supports encrypting individual variables within the project. Copy the created access token and, in your command line, run the command:

```bash
pulumi config set --secret github-token YOUR_SECRET_PERSONAK_ACCESS_TOKEN
```

Next, add a credentials resource in your `index.ts`:

```ts
const config = new pulumi.Config();

new aws.codebuild.SourceCredential('github-token', {
  authType: 'PERSONAL_ACCESS_TOKEN',
  serverType: 'GITHUB',
  token: config.requireSecret('github-token'),
});
```

This will create a new source credential resource with the name 'github-token' containing your GitHub Personal Access Token. The `pulumi.Config()` class lets us read the config we just saved using your command line, and decrypt the secret's value.

## Triggering Builds

If you deployed this now you'd get a build that you could manually start and would build whatever's in your repository. However, it would be more useful if it automatically started building as soon as you pushed new code to GitHub!

To listen for changes from GitHub we need a "webhook". Add the following resource to build on each new commit pushed to master...

```ts
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
```

Line-by-line again...

1. Define the resource type to create and give it a name
2. Pass the name of the CodeBuild project to trigger
3. Filter to only the events you're interested in: when a commit is pushed to the `master` branch

## Authenticating CodeBuild with Pulumi

For Pulumi to work in an automated environment you need to [create a new Pulumi "Access Token"](https://app.pulumi.com/danielrbradley/settings/tokens). Copy the token and let's use Pulumi's encrypted config again to store it:

```bash
pulumi config set --secret pulumi-access-token YOUR_PULUMI_ACCESS_TOKEN
```

AWS SSM Parameter Store is a great way to store sensitive values like this within your infrastructure. Let's create a resource to hold the secret value:

```ts
const pulumiAccessToken = new aws.ssm.Parameter('pulumi-access-token', {
  type: 'String',
  value: config.requireSecret('pulumi-access-token'),
});
```

We need the access token in the build environment. Let's change the `buildProject` resource to load the token from the SSM parameter:

```ts
const buildProject = new aws.codebuild.Project('build-setup', {
  //---------- SNIP ----------//
  environment: {
    //---------- SNIP ----------//
    environmentVariables: [
      {
        type: 'PARAMETER_STORE',
        name: 'PULUMI_ACCESS_TOKEN',
        value: pulumiAccessToken.name,
      },
    ],
  },
  //---------- SNIP ----------//
});
```

## CodeBuild Build Specification

The final step of configuration is to tell CodeBuild how to build our project.

CodeBuild will automatically look for a file called `buildspec.yml` at the root of your repository - let's create that now.

```yml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 12
    commands:
      - curl -fsSL https://get.pulumi.com | sh
      - PATH=$PATH:/root/.pulumi/bin
  pre_build:
    commands:
      - npm ci
      - pulumi login --non-interactive
  build:
    commands:
      - pulumi up --non-interactive
```

Running through the sections line-by-line:

1. Install the Node.js v12.x runtime
2. Download and install Pulumi
3. Make `pulumi` available on the `$PATH`
4. Restore packages using NPM
5. Log in to Pulumi (uses the `PULUMI_ACCESS_TOKEN` environment variable)
6. Run Pulumi deploy

The `--non-interactive` option is available on all Pulumi CLI commands to ensure that it doesn't prompt for input at any stage which would cause the build to hang and timeout.

## Our first deployment

Right, that's all the coding done! Now to do our first deployment.

1. Open your command line
2. Run `pulumi up`
3. You'll get a preview of what it's about to do, then select "Yes" to continue

That's it!

The deployment should only take a couple of minutes.

## Summary

1. You created a GitHub project containing a TypeScript file which contains the definitions of a CodeBuild project to create.
2. This CodeBuild project is configured to watch for changes to the GitHub project and re-deploy itself on each change.
3. Deployed the first version from your local machine.
4. Now you can add a few lines of code and push it to GitHub to setup whole new build pipelines!

Getting to the point of the first deploy takes some work, but once you're up and running this is a very efficient and elegant process for managing build projects. At work we've been testing this setup for around a year and have 28 projects configured using this method. The feedback from every developer has been overwhelmingly positive compared to our old Jenkins setup.

From here, there's many interesting avenues to explore:

- Adding more repositories to build
- Testing changes in pull requests
- Using CloudWatch and Lambda to monitor builds and alert you to failures
- Use CloudWatch scheduled triggers for nightly build tasks
- Abstracting the code to reduce the amount of code you have to write for each new GitHub repository you want to build

Would love to hear about where you take this!
