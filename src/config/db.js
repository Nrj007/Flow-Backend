import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { env } from './env.js';

const clientConfig = {
  region: env.aws.region,
};

if (env.aws.dynamodbEndpoint) {
  clientConfig.endpoint = env.aws.dynamodbEndpoint;
  clientConfig.credentials = {
    accessKeyId: env.aws.accessKeyId || 'local',
    secretAccessKey: env.aws.secretAccessKey || 'local',
  };
} else if (env.aws.accessKeyId && env.aws.secretAccessKey) {
  clientConfig.credentials = {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  };
}

const client = new DynamoDBClient(clientConfig);

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = env.aws.tableName;
