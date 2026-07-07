export type BoardEventPayloadEnvelope = {
  schemaVersion: 1;
  eventType: string;
  payload: unknown;
};

export function encodeBoardEventPayload(
  eventType: string,
  payload: unknown
): BoardEventPayloadEnvelope {
  return {
    schemaVersion: 1,
    eventType,
    payload
  };
}

export function decodeBoardEventPayload(eventType: string, payloadJson: unknown): unknown {
  if (isPayloadEnvelope(payloadJson)) {
    return payloadJson.payload;
  }

  return payloadJson;
}

function isPayloadEnvelope(value: unknown): value is BoardEventPayloadEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    'eventType' in value &&
    typeof (value as { eventType?: unknown }).eventType === 'string' &&
    'payload' in value
  );
}
