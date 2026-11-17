import {
  CronCapability,
  HTTPClient,
  handler,
  ConsensusAggregationByFields,
  median,
  type Runtime,
  type HTTPSendRequester,
  Runner,
  cre,
  getNetwork,
  hexToBase64,
  bytesToHex,
  TxStatus,
} from "@chainlink/cre-sdk"

import { encodeAbiParameters, parseAbiParameters } from "viem"

type Config = {
  schedule: string
  apiUrl: string
  chainName: string
  oracleAddress: string
  gasLimit: string
}

type AqiData = {
  aqi: number
}

type OpenMeteoResponse = {
  current?: {
    us_aqi?: number | null
  }
}

// Each node fetches and validates the API response.
const fetchAqi = (
  sendRequester: HTTPSendRequester,
  config: Config
): AqiData => {
  const response = sendRequester
    .sendRequest({
      url: config.apiUrl,
      method: "GET" as const,
    })
    .result()

  if (response.statusCode !== 200) {
    throw new Error(`API returned status ${response.statusCode}`)
  }

  const body = JSON.parse(
    new TextDecoder().decode(response.body)
  ) as OpenMeteoResponse

  const aqi = body.current?.us_aqi

  if (
    typeof aqi !== "number" ||
    !Number.isFinite(aqi) ||
    aqi < 0 ||
    aqi > 1000
  ) {
    throw new Error("API returned an invalid AQI")
  }

  return { aqi: Math.round(aqi) }
}

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const httpClient = new HTTPClient()

  const result = httpClient
    .sendRequest(
      runtime,
      fetchAqi,
      ConsensusAggregationByFields<AqiData>({
        aqi: median,
      })
    )(runtime.config)
    .result()

  // Round again because aggregation can produce a fractional median.
  const aqi = Math.round(result.aqi)

  if (!Number.isSafeInteger(aqi) || aqi < 0 || aqi > 1000) {
    throw new Error("Aggregated AQI is invalid")
  }

  runtime.log(`Lahore US AQI: ${aqi}`)

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainName,
    isTestnet: true,
  })

  if (!network) {
    throw new Error(`Unknown network: ${runtime.config.chainName}`)
  }

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector
  )

  // Matches abi.decode(report, (uint256)) in AirQualityOracle.
  const encodedAqi = encodeAbiParameters(
    parseAbiParameters("uint256 aqi"),
    [BigInt(aqi)]
  )

  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodedAqi),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()

  runtime.log(`Sending AQI to ${runtime.config.oracleAddress}`)

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.oracleAddress,
      report,
      gasConfig: {
        gasLimit: runtime.config.gasLimit,
      },
    })
    .result()

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `Report write did not succeed. Status: ${writeResult.txStatus}`
    )
  }

  const txHash = writeResult.txHash
    ? bytesToHex(writeResult.txHash)
    : undefined

  runtime.log(`Report write succeeded. AQI: ${aqi}`)

  if (txHash) {
    runtime.log(`Transaction hash: ${txHash}`)
  }

  return txHash ?? `Report write succeeded. AQI: ${aqi}`
}

const initWorkflow = (config: Config) => {
  return [
    handler(
      new CronCapability().trigger({
        schedule: config.schedule,
      }),
      onCronTrigger
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}

main()