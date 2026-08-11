# DynamoDB Table Setup for Flow

Create the `FlowTable` with the following key schema and GSIs.

## Primary Key
- **PK** (String) — Partition key
- **SK** (String) — Sort key

## Global Secondary Indexes

### GSI1 — Email lookup
- **GSI1PK** (String) — Partition key (`EMAIL#<email>`)
- **GSI1SK** (String) — Sort key (`USER#<userId>`)
- Projection: ALL

### GSI2 — Role / shop listing
- **GSI2PK** (String) — Partition key (`ROLE#<role>` or `ROLE#SHOP`)
- **GSI2SK** (String) — Sort key
- Projection: ALL

## AWS CLI (example)

```bash
aws dynamodb create-table \
  --table-name FlowTable \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    AttributeName=GSI2PK,AttributeType=S \
    AttributeName=GSI2SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    "[{\"IndexName\":\"GSI1\",\"KeySchema\":[{\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}},{\"IndexName\":\"GSI2\",\"KeySchema\":[{\"AttributeName\":\"GSI2PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI2SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]" \
  --billing-mode PAY_PER_REQUEST
```

For local development, use [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) and set `DYNAMODB_ENDPOINT=http://localhost:8000` in `.env`.
