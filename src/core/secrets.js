// The playlist never holds a credential directly -- a field like
// `mqtt-broker.password_env = "MQTT_BROKER_PASSWORD"` names an environment
// variable instead. An adapter that needs the real value calls this with
// that name. The variable itself lives in a gitignored .env file, loaded by
// running with `node --env-file=.env` (native to Node, no dependency).
export function resolveSecretEnv(envVarName) {
  const value = process.env[envVarName];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${envVarName}`);
  }
  return value;
}
