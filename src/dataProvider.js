import { useMemo, useState, useEffect } from 'react'
import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import { chain, sumBy, sortBy, maxBy, minBy } from 'lodash'
import fetch from 'cross-fetch';
import * as ethers from 'ethers'

import { fillPeriods } from './helpers'
import { addresses, getAddress, ARBITRUM, AVALANCHE } from './addresses'

const BigNumber = ethers.BigNumber
const formatUnits = ethers.utils.formatUnits
const { JsonRpcProvider } = ethers.providers

import RewardReader from '../abis/RewardReader.json'
import GlpManager from '../abis/GlpManager.json'
import Token from '../abis/v1/Token.json'

const providers = {
  arbitrum: new JsonRpcProvider('https://arbitrum.blockpi.network/v1/rpc/public'),
  avalanche: new JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc')
}

function getProvider(chainName) {
  if (!(chainName in providers)) {
    throw new Error(`Unknown chain ${chainName}`)
  }
  return providers[chainName]
}

function getChainId(chainName) {
  const chainId = {
    arbitrum: ARBITRUM,
    avalanche: AVALANCHE
  }[chainName]
  if (!chainId) {
    throw new Error(`Unknown chain ${chainName}`)
  }
  return chainId
}

const NOW_TS = parseInt(Date.now() / 1000)
const FIRST_DATE_TS = parseInt(+(new Date(2021, 7, 31)) / 1000)

function fillNa(arr) {
  const prevValues = {}
  let keys
  if (arr.length > 0) {
    keys = Object.keys(arr[0])
    delete keys.timestamp
    delete keys.id
  }

  for (const el of arr) {
    for (const key of keys) {
      if (!el[key]) {
        if (prevValues[key]) {
          el[key] = prevValues[key]
        }
      } else {
        prevValues[key] = el[key]
      }
    }
  }
  return arr
}

export async function queryEarnData(chainName, account) {
  const provider = getProvider(chainName)
  const chainId = getChainId(chainName)
  const rewardReader = new ethers.Contract(getAddress(chainId, 'RewardReader'), RewardReader.abi, provider)
  const glpContract = new ethers.Contract(getAddress(chainId, 'GLP'), Token.abi, provider)
  const glpManager = new ethers.Contract(getAddress(chainId, 'GlpManager'), GlpManager.abi, provider)

  let depositTokens
  let rewardTrackersForDepositBalances
  let rewardTrackersForStakingInfo

  if (chainId === ARBITRUM) {
    depositTokens = ['0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', '0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA', '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0x35247165119B69A40edD5304969560D0ef486921', '0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258']
    rewardTrackersForDepositBalances = ['0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0xd2D1162512F927a7e282Ef43a362659E4F2a728F', '0xd2D1162512F927a7e282Ef43a362659E4F2a728F', '0x4e971a87900b931fF39d1Aad67697F49835400b6']
    rewardTrackersForStakingInfo = ['0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0xd2D1162512F927a7e282Ef43a362659E4F2a728F', '0x1aDDD80E6039594eE970E5872D247bf0414C8903', '0x4e971a87900b931fF39d1Aad67697F49835400b6']
  } else {
    depositTokens = ['0x62edc0692BD897D2295872a9FFCac5425011c661', '0xFf1489227BbAAC61a9209A08929E4c2a526DdD17', '0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342', '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x8087a341D32D445d9aC8aCc9c14F5781E04A26d2', '0x01234181085565ed162a948b6a5e88758CD7c7b8']
    rewardTrackersForDepositBalances = ['0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342', '0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342', '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0xd2D1162512F927a7e282Ef43a362659E4F2a728F']
    rewardTrackersForStakingInfo = ['0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342', '0x908C4D94D34924765f1eDc22A1DD098397c59dD4', '0x4d268a7d4C16ceB5a606c173Bd974984343fea13', '0x9e295B5B976a184B14aD8cd72413aD846C299660', '0xd2D1162512F927a7e282Ef43a362659E4F2a728F']
  }

  const [
    balances,
    stakingInfo,
    glpTotalSupply,
    glpAum,
    gmxPrice
  ] = await Promise.all([
    rewardReader.getDepositBalances(account, depositTokens, rewardTrackersForDepositBalances),
    rewardReader.getStakingInfo(account, rewardTrackersForStakingInfo).then(info => {
      return rewardTrackersForStakingInfo.map((_, i) => {
        return info.slice(i * 5, (i + 1) * 5)
      })
    }),
    glpContract.totalSupply(),
    glpManager.getAumInUsdg(true),
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=gmx&vs_currencies=usd').then(async res => {
      const j = await res.json()
      return j['gmx']['usd']
    })
  ])

  const glpPrice = (glpAum / 1e18) / (glpTotalSupply / 1e18)
  const now = new Date()

  return {
    GLP: {
      stakedGLP: balances[5] / 1e18,
      pendingETH: stakingInfo[4][0] / 1e18,
      pendingEsGMX: stakingInfo[3][0] / 1e18,
      glpPrice
    },
    GMX: {
      stakedGMX: balances[0] / 1e18,
      stakedEsGMX: balances[1] / 1e18,
      pendingETH: stakingInfo[2][0] / 1e18,
      pendingEsGMX: stakingInfo[0][0] / 1e18,
      gmxPrice
    },
    timestamp: parseInt(now / 1000),
    datetime: now.toISOString()
  }
}

export const tokenDecimals = {
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 18, // WETH
  "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": 8, // BTC
  "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 6, // USDC
  "0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0": 18, // UNI
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 6, // USDT
  "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": 18, // LINK
  "0xfea7a6a0b346362bf88a9e4a88416b77a57d6c2a": 18, // MIM
  "0x17fc002b466eec40dae837fc4be5c67993ddbd6f": 18, // FRAX
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": 18, // DAI
}

export const tokenSymbols = {
  // Arbitrum
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'BTC',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'ETH',
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 'LINK',
  '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 'UNI',
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 'USDC',
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
  '0xfea7a6a0b346362bf88a9e4a88416b77a57d6c2a': 'MIM',
  '0x17fc002b466eec40dae837fc4be5c67993ddbd6f': 'FRAX',
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',

  // Avalanche
  '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7': 'AVAX',
  '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab': 'WETH.e',
  '0x50b7545627a5162f82a992c33b87adc75187b218': 'WBTC.e',
  '0x130966628846bfd36ff31a822705796e8cb8c18d': 'MIM',
  '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664': 'USDC.e',
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC'
}

function getTokenDecimals(token) {
  return tokenDecimals[token] || 18
}

const knownSwapSources = {
  arbitrum: {
    '0xabbc5f99639c9b6bcb58544ddf04efa6802f4064': 'GMX Router', // Router
    '0x09f77e8a13de9a35a7231028187e9fd5db8a2acb': 'GMX OrderBook', // Orderbook
    '0x98a00666cfcb2ba5a405415c2bf6547c63bf5491': 'GMX PositionManager A', // PositionManager old
    '0x87a4088bd721f83b6c2e5102e2fa47022cb1c831': 'GMX PositionManager B', // PositionManager
    '0x75e42e6f01baf1d6022bea862a28774a9f8a4a0c': 'GMX PositionManager C', // PositionManager 12 oct 2022
    '0xb87a436b93ffe9d75c5cfa7bacfff96430b09868': 'GMX PositionRouter C', // PositionRouter 12 oct 2022
    '0x7257ac5d0a0aac04aa7ba2ac0a6eb742e332c3fb': 'GMX OrderExecutor', // OrderExecutor
    '0x1a0ad27350cccd6f7f168e052100b4960efdb774': 'GMX FastPriceFeed A', // FastPriceFeed
    '0x11d62807dae812a0f1571243460bf94325f43bb7': 'GMX PositionExecutor', // Position Executor
    '0x3b6067d4caa8a14c63fdbe6318f27a0bbc9f9237': 'Dodo',
    '0x11111112542d85b3ef69ae05771c2dccff4faa26': '1inch',
    '0x6352a56caadc4f1e25cd6c75970fa768a3304e64': 'OpenOcean', // OpenOceanExchangeProxy
    '0x4775af8fef4809fe10bf05867d2b038a4b5b2146': 'Gelato',
    '0x5a9fd7c39a6c488e715437d7b1f3c823d5596ed1': 'LiFiDiamond',
    '0x1d838be5d58cc131ae4a23359bc6ad2dddb8b75a': 'Vovo', // Vovo BTC UP USDC (vbuUSDC)
    '0xc4bed5eeeccbe84780c44c5472e800d3a5053454': 'Vovo', // Vovo ETH UP USDC (veuUSDC)
    '0xe40beb54ba00838abe076f6448b27528dd45e4f0': 'Vovo', // Vovo BTC UP USDC (vbuUSDC)
    '0x9ba57a1d3f6c61ff500f598f16b97007eb02e346': 'Vovo', // Vovo ETH UP USDC (veuUSDC)
    '0xfa82f1ba00b0697227e2ad6c668abb4c50ca0b1f': 'JonesDAO',
    '0x226cb17a52709034e2ec6abe0d2f0a9ebcec1059': 'WardenSwap',
    '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch',
    '0x6d7a3177f3500bea64914642a49d0b5c0a7dae6d': 'deBridge',
    '0xc30141b657f4216252dc59af2e7cdb9d8792e1b0': 'socket.tech',
    '0xdd94018f54e565dbfc939f7c44a16e163faab331': 'Odos Router'
  },
  avalanche: {
    '0xA76fB4882bcb66fBe68948B71eBe7f3B80e329Ea': 'GMX OrderBook', //
    '0x6A154CE91003Cf4b8787280fd7C96D9BFb3f88C3': 'GMX Router', //
    '0x7d9d108445f7e59a67da7c16a2ceb08c85b76a35': 'GMX FastPriceFeed', // FastPriceFeed
    '0xD5326A526f78667375D9D5dA7C739e261Df52fe6': 'GMX PositionManager', // PositionManager //
    '0xD5326A526f78667375D9D5dA7C739e261Df52fe6': 'GMX PositionManager C', // 
    '0xFe42F6CccD52542DFbB785dFa014Cb8ce70Bcf57': 'GMX PositionRouter C', // 
    '0xc4729e56b831d74bbc18797e0e17a295fa77488c': 'Yak',
    '0x409e377a7affb1fd3369cfc24880ad58895d1dd9': 'Dodo',
    '0x6352a56caadc4f1e25cd6c75970fa768a3304e64': 'OpenOcean',
    '0x7c5c4af1618220c090a6863175de47afb20fa9df': 'Gelato',
    '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch',
    '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap',
    '0x2ecf2a2e74b19aab2a62312167aff4b78e93b6c5': 'ParaSwap',
    '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x',
    '0xe547cadbe081749e5b3dc53cb792dfaea2d02fd2': 'GMX PositionExecutor' // Position Executor
  }
}

const defaultFetcher = url => fetch(url).then(res => res.json())
export function useRequest(url, defaultValue, fetcher = defaultFetcher) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState()
  const [data, setData] = useState(defaultValue)

  useEffect(async () => {
    try {
      setLoading(true)
      const data = await fetcher(url)
      setData(data)
    } catch (ex) {
      console.error(ex)
      setError(ex)
    }
    setLoading(false)
  }, [url])

  return [data, loading, error]
}

export function useCoingeckoPrices(symbol, { from = FIRST_DATE_TS } = {}) {
  // token ids https://api.coingecko.com/api/v3/coins
  const _symbol = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    LINK: 'chainlink',
    UNI: 'uniswap',
    AVAX: 'avalanche-2'
  }[symbol]

  const now = Date.now() / 1000
  const days = Math.ceil(now / 86400) - Math.ceil(from / 86400) - 1

  const url = `https://api.coingecko.com/api/v3/coins/${_symbol}/market_chart?vs_currency=usd&days=${days}&interval=daily`

  const [res, loading, error] = useRequest(url)

  const data = useMemo(() => {
    if (!res || res.length === 0) {
      return null
    }

    const ret = res.prices.map(item => {
      // -1 is for shifting to previous day
      // because CG uses first price of the day, but for GLP we store last price of the day
      const timestamp = item[0] - 1
      const groupTs = parseInt(timestamp / 1000 / 86400) * 86400
      return {
        timestamp: groupTs,
        value: item[1]
      }
    })
    return ret
  }, [res])

  return [data, loading, error]
}

function getImpermanentLoss(change) {
  return 2 * Math.sqrt(change) / (1 + change) - 1
}

function getChainSubgraph(chainName) {
  return chainName === "arbitrum" ? "superronaldo/waifu-stats" : "superronaldo/waifu-stats"
}

export function useGraph(querySource, { subgraph = null, subgraphUrl = null, chainName = "arbitrum" } = {}) {
  const query = gql(querySource)

  if (!subgraphUrl) {
    if (!subgraph) {
      subgraph = getChainSubgraph(chainName)
    }
    subgraphUrl = `https://api.thegraph.com/subgraphs/name/${subgraph}`;
  }

  const client = new ApolloClient({
    link: new HttpLink({ uri: subgraphUrl, fetch }),
    cache: new InMemoryCache()
  })
  const [data, setData] = useState()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
  }, [querySource, setLoading])

  useEffect(() => {
    client.query({query}).then(res => {
      setData(res.data)
      setLoading(false)
    }).catch(ex => {
      console.warn('Subgraph request failed error: %s subgraphUrl: %s', ex.message, subgraphUrl)
      setError(ex)
      setLoading(false)
    })
  }, [querySource, setData, setError, setLoading])

  return [data, loading, error]
}

export function useLastBlock(chainName = "arbitrum") {
  const [data, setData] = useState()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    providers[chainName].getBlock()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  return [data, loading, error]
}

export function useLastSubgraphBlock(chainName = "arbitrum") {
  const [data, loading, error] = useGraph(`{
    _meta {
      block {
        number
      }
    }
  }`, { chainName })
  const [block, setBlock] = useState(null)

  useEffect(() => {
    if (!data) {
      return
    }

    providers[chainName].getBlock(data._meta.block.number).then(block => {
      setBlock(block)
    })
  }, [data, setBlock])

  return [block, loading, error]
}

export function useTradersData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const [closedPositionsData, loading, error] = useGraph(`{
    tradingStats(
      first: 1000
      orderBy: timestamp
      orderDirection: desc
      where: { period: "daily", timestamp_gte: ${from}, timestamp_lte: ${to} }
      subgraphError: allow
    ) {
      timestamp
      profit
      loss
      profitCumulative
      lossCumulative
      longOpenInterest
      shortOpenInterest
    }
  }`, { chainName })
  const [feesData] = useFeesData({ from, to, chainName })
  const marginFeesByTs = useMemo(() => {
    if (!feesData) {
      return {}
    }

    let feesCumulative = 0
    return feesData.reduce((memo, { timestamp, margin: fees}) => {
      feesCumulative += fees
      memo[timestamp] = {
        fees,
        feesCumulative
      }
      return memo
    }, {})
  }, [feesData])

  let ret = null
  let currentPnlCumulative = 0;
  let currentProfitCumulative = 0;
  let currentLossCumulative = 0;
  const data = closedPositionsData ? sortBy(closedPositionsData.tradingStats, i => i.timestamp).map(dataItem => {
    const longOpenInterest = dataItem.longOpenInterest / 1e30
    const shortOpenInterest = dataItem.shortOpenInterest / 1e30
    const openInterest = longOpenInterest + shortOpenInterest

    // const fees = (marginFeesByTs[dataItem.timestamp]?.fees || 0)
    // const feesCumulative = (marginFeesByTs[dataItem.timestamp]?.feesCumulative || 0)

    const profit = dataItem.profit / 1e30
    const loss = dataItem.loss / 1e30
    const profitCumulative = dataItem.profitCumulative / 1e30
    const lossCumulative = dataItem.lossCumulative / 1e30
    const pnlCumulative = profitCumulative - lossCumulative
    const pnl = profit - loss
    currentProfitCumulative += profit
    currentLossCumulative -= loss
    currentPnlCumulative += pnl
    return {
      longOpenInterest,
      shortOpenInterest,
      openInterest,
      profit,
      loss: -loss,
      profitCumulative,
      lossCumulative: -lossCumulative,
      pnl,
      pnlCumulative,
      timestamp: dataItem.timestamp,
      currentPnlCumulative,
      currentLossCumulative,
      currentProfitCumulative
    }
  }) : null

  if (data && data.length) {
    const maxProfit = maxBy(data, item => item.profit).profit
    const maxLoss = minBy(data, item => item.loss).loss
    const maxProfitLoss = Math.max(maxProfit, -maxLoss)

    const maxPnl = maxBy(data, item => item.pnl).pnl
    const minPnl = minBy(data, item => item.pnl).pnl
    const maxCurrentCumulativePnl = maxBy(data, item => item.currentPnlCumulative).currentPnlCumulative
    const minCurrentCumulativePnl = minBy(data, item => item.currentPnlCumulative).currentPnlCumulative

    const currentProfitCumulative = data[data.length - 1].currentProfitCumulative
    const currentLossCumulative = data[data.length - 1].currentLossCumulative
    const stats = {
      maxProfit,
      maxLoss,
      maxProfitLoss,
      currentProfitCumulative,
      currentLossCumulative,
      maxCurrentCumulativeProfitLoss: Math.max(currentProfitCumulative, -currentLossCumulative),

      maxAbsPnl: Math.max(
        Math.abs(maxPnl),
        Math.abs(minPnl),
      ),
      maxAbsCumulativePnl: Math.max(
        Math.abs(maxCurrentCumulativePnl),
        Math.abs(minCurrentCumulativePnl)
      ),
      
    }

    ret = {
      data,
      stats
    }
  }

  return [ret, loading]
}

function getSwapSourcesFragment(skip = 0, from, to) {
  return `
    hourlyVolumeBySources(
      first: 1000
      skip: ${skip}
      orderBy: timestamp
      orderDirection: desc
      where: { timestamp_gte: ${from}, timestamp_lte: ${to} }
      subgraphError: allow
    ) {
      timestamp
      source
      swap
    }
  `
}
export function useSwapSources({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const query = `{
    a: ${getSwapSourcesFragment(0, from, to)}
    b: ${getSwapSourcesFragment(1000, from, to)}
    c: ${getSwapSourcesFragment(2000, from, to)}
    d: ${getSwapSourcesFragment(3000, from, to)}
    e: ${getSwapSourcesFragment(4000, from, to)}
  }`
  const [graphData, loading, error] = useGraph(query, { chainName })

  let data = useMemo(() => {
    if (!graphData) {
      return null
    }

    const {a, b, c, d, e} = graphData
    const all = [...a, ...b, ...c, ...d, ...e]

    const totalVolumeBySource = a.reduce((acc, item) => {
      const source = knownSwapSources[chainName][item.source] || item.source
      if (!acc[source]) {
        acc[source] = 0
      }
      acc[source] += item.swap / 1e30
      return acc
    }, {})
    const topVolumeSources = new Set(
      Object.entries(totalVolumeBySource).sort((a, b) => b[1] - a[1]).map(item => item[0]).slice(0, 30)
    )

    let ret = chain(all)
      .groupBy(item => parseInt(item.timestamp / 86400) * 86400)
      .map((values, timestamp) => {
        let all = 0
        const retItem = {
          timestamp: Number(timestamp),
          ...values.reduce((memo, item) => {
            let source = knownSwapSources[chainName][item.source] || item.source
            if (!topVolumeSources.has(source)) {
              source = 'Other'
            }
            if (item.swap != 0) {
              const volume = item.swap / 1e30
              memo[source] = memo[source] || 0
              memo[source] += volume
              all += volume
            }
            return memo
          }, {})
        }

        retItem.all = all

        return retItem
      })
      .sortBy(item => item.timestamp)
      .value()

    return ret
  }, [graphData])

  return [data, loading, error]
}

export function useTotalVolumeFromServer() {
  const [data, loading] = useRequest('https://gmx-server-mainnet.uw.r.appspot.com/total_volume')

  return useMemo(() => {
    if (!data) {
      return [data, loading]
    }

    const total = data.reduce((memo, item) => {
      return memo + parseInt(item.data.volume) / 1e30
    }, 0)
    return [total, loading]
  }, [data, loading])
}

function getServerHostname(chainName) {
  if (chainName == "avalanche") {
    return 'gmx-avax-server.uc.r.appspot.com'
  }
  return 'gmx-server-mainnet.uw.r.appspot.com'
}

export function useVolumeDataRequest(url, defaultValue, from, to, fetcher = defaultFetcher) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState()
  const [data, setData] = useState(defaultValue)

  useEffect(async () => {
    try {
      setLoading(true)
      const data = await fetcher(url)
      setData(data)
    } catch (ex) {
      console.error(ex)
      setError(ex)
    }
    setLoading(false)
  }, [url, from, to])

  return [data, loading, error]
}

export function useVolumeDataFromServer({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const PROPS = 'margin liquidation swap mint burn'.split(' ')
  const [data, loading] = useVolumeDataRequest(`https://${getServerHostname(chainName)}/daily_volume`, null, from, to, async url => {
    let after
    const ret = []
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await (await fetch(url + (after ? `?after=${after}` : ''))).json()
      if (res.length === 0) return ret
      for (const item of res) {
        if (item.data.timestamp < from) {
          return ret
        }
        ret.push(item)
      }
      after = res[res.length - 1].id
    }
  })

  const ret = useMemo(() => {
    if (!data) {
      return null
    }

    const tmp = data.reduce((memo, item) => {
      const timestamp = item.data.timestamp
      if (timestamp < from || timestamp > to) {
        return memo
      }

      let type
      if (item.data.action === 'Swap') {
        type = 'swap'
      } else if (item.data.action === 'SellUSDG') {
        type = 'burn'
      } else if (item.data.action === 'BuyUSDG') {
        type = 'mint'
      } else if (item.data.action.includes('LiquidatePosition')) {
        type = 'liquidation'
      } else {
        type = 'margin'
      }
      const volume = Number(item.data.volume) / 1e30
      memo[timestamp] = memo[timestamp] || {}
      memo[timestamp][type] = memo[timestamp][type] || 0
      memo[timestamp][type] += volume
      return memo
    }, {})

    let cumulative = 0
    const cumulativeByTs = {}
    return Object.keys(tmp).sort().map(timestamp => {
      const item = tmp[timestamp]
      let all = 0

      let movingAverageAll
      const movingAverageTs = timestamp - MOVING_AVERAGE_PERIOD
      if (movingAverageTs in cumulativeByTs) {
        movingAverageAll = (cumulative - cumulativeByTs[movingAverageTs]) / MOVING_AVERAGE_DAYS
      }

      PROPS.forEach(prop => {
        if (item[prop]) all += item[prop]
      })
      cumulative += all
      cumulativeByTs[timestamp] = cumulative
      return {
        timestamp,
        all,
        cumulative,
        movingAverageAll,
        ...item
      }
    })
  }, [data, from, to])

  return [ret, loading]
}

export function useUsersData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const query = `{
    userStats(
      first: 1000
      orderBy: timestamp
      orderDirection: desc
      where: { period: "daily", timestamp_gte: ${from}, timestamp_lte: ${to} }
      subgraphError: allow
    ) {
      uniqueCount
      uniqueSwapCount
      uniqueMarginCount
      uniqueMintBurnCount
      uniqueCountCumulative
      uniqueSwapCountCumulative
      uniqueMarginCountCumulative
      uniqueMintBurnCountCumulative
      actionCount
      actionSwapCount
      actionMarginCount
      actionMintBurnCount
      timestamp
    }
  }`
  const [graphData, loading, error] = useGraph(query, { chainName })

  const prevUniqueCountCumulative = {}
  let cumulativeNewUserCount = 0;
  const data = graphData ? sortBy(graphData.userStats, 'timestamp').map(item => {
    const newCountData = ['', 'Swap', 'Margin', 'MintBurn'].reduce((memo, type) => {
      memo[`new${type}Count`] = prevUniqueCountCumulative[type]
        ? item[`unique${type}CountCumulative`] - prevUniqueCountCumulative[type]
        : item[`unique${type}Count`]
      prevUniqueCountCumulative[type] = item[`unique${type}CountCumulative`]
      return memo
    }, {})
    cumulativeNewUserCount += newCountData.newCount;
    const oldCount = item.uniqueCount - newCountData.newCount
    const oldPercent = (oldCount / item.uniqueCount * 100).toFixed(1)
    return {
      all: item.uniqueCount,
      uniqueSum: item.uniqueSwapCount + item.uniqueMarginCount + item.uniqueMintBurnCount,
      oldCount,
      oldPercent,
      cumulativeNewUserCount,
      ...newCountData,
      ...item
    }
  }) : null

  return [data, loading, error]
}

export function useFundingRateData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const query = `{
    fundingRates(
      first: 1000,
      orderBy: timestamp,
      orderDirection: desc,
      where: { period: "daily", id_gte: ${from}, id_lte: ${to} }
      subgraphError: allow
    ) {
      id,
      token,
      timestamp,
      startFundingRate,
      startTimestamp,
      endFundingRate,
      endTimestamp
    }
  }`
  const [graphData, loading, error] = useGraph(query, { chainName })


  const data = useMemo(() => {
    if (!graphData) {
      return null
    }

    const groups = graphData.fundingRates.reduce((memo, item) => {
      const symbol = tokenSymbols[item.token]
      if (symbol === 'MIM') {
        return memo
      }
      memo[item.timestamp] = memo[item.timestamp] || {
        timestamp: item.timestamp
      }
      const group = memo[item.timestamp]
      const timeDelta = parseInt((item.endTimestamp - item.startTimestamp) / 3600) * 3600

      let fundingRate = 0
      if (item.endFundingRate && item.startFundingRate) {
        const fundingDelta = item.endFundingRate - item.startFundingRate
        const divisor = timeDelta / 86400
        fundingRate = fundingDelta / divisor / 10000 * 365
      }
      group[symbol] = fundingRate
      return memo
    }, {})
    
    return fillNa(sortBy(Object.values(groups), 'timestamp'))
  }, [graphData])

  return [data, loading, error]
}

const MOVING_AVERAGE_DAYS = 7
const MOVING_AVERAGE_PERIOD = 86400 * MOVING_AVERAGE_DAYS

export function useVolumeData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
	const PROPS = 'margin liquidation swap mint burn'.split(' ')
  const timestampProp = chainName === "arbitrum" ? "id" : "timestamp"
  const query = `{
    volumeStats(
      first: 1000,
      orderBy: ${timestampProp},
      orderDirection: desc
      where: { period: daily, ${timestampProp}_gte: ${from}, ${timestampProp}_lte: ${to} }
      subgraphError: allow
    ) {
      ${timestampProp}
      ${PROPS.join('\n')}
    }
  }`
  const [graphData, loading, error] = useGraph(query, { chainName })

  const data = useMemo(() => {
    if (!graphData) {
      return null
    }

    let ret =  sortBy(graphData.volumeStats, timestampProp).map(item => {
      const ret = { timestamp: item[timestampProp] };
      let all = 0;
      PROPS.forEach(prop => {
        ret[prop] = item[prop] / 1e30
        all += ret[prop]
      })
      ret.all = all
      return ret
    })

    let cumulative = 0
    const cumulativeByTs = {}
    return ret.map(item => {
      cumulative += item.all

      let movingAverageAll
      const movingAverageTs = item.timestamp - MOVING_AVERAGE_PERIOD
      if (movingAverageTs in cumulativeByTs) {
        movingAverageAll = (cumulative - cumulativeByTs[movingAverageTs]) / MOVING_AVERAGE_DAYS
      }

      return {
        movingAverageAll,
        cumulative,
        ...item
      }
    })
  }, [graphData])

  return [data, loading, error]
}

export function useFeesData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const PROPS = 'margin liquidation swap mint burn'.split(' ')
  const feesQuery = `{
    feeStats(
      first: 1000
      orderBy: id
      orderDirection: desc
      where: { period: daily, id_gte: ${from}, id_lte: ${to} }
      subgraphError: allow
    ) {
      id
      margin
      marginAndLiquidation
      swap
      mint
      burn
      ${chainName === "avalanche" ? "timestamp" : ""}
    }
  }`
  let [feesData, loading, error] = useGraph(feesQuery, {
    chainName
  })

  const feesChartData = useMemo(() => {
    if (!feesData) {
      return null
    }

    let chartData = sortBy(feesData.feeStats, 'id').map(item => {
      const ret = { timestamp: item.timestamp || item.id };

      PROPS.forEach(prop => {
        if (item[prop]) {
          ret[prop] = item[prop] / 1e30
        }
      })

      ret.liquidation = item.marginAndLiquidation / 1e30 - item.margin / 1e30
      ret.all = PROPS.reduce((memo, prop) => memo + ret[prop], 0)
      return ret
    })

    let cumulative = 0
    const cumulativeByTs = {}
    return chain(chartData)
      .groupBy(item => item.timestamp)
      .map((values, timestamp) => {
        const all = sumBy(values, 'all')
        cumulative += all

        let movingAverageAll
        const movingAverageTs = timestamp - MOVING_AVERAGE_PERIOD
        if (movingAverageTs in cumulativeByTs) {
          movingAverageAll = (cumulative - cumulativeByTs[movingAverageTs]) / MOVING_AVERAGE_DAYS
        }

        const ret = {
          timestamp: Number(timestamp),
          all,
          cumulative,
          movingAverageAll
        }
        PROPS.forEach(prop => {
           ret[prop] = sumBy(values, prop)
        })
        cumulativeByTs[timestamp] = cumulative
        return ret
      })
      .value()
      .filter(item => item.timestamp >= from)
  }, [feesData])

  return [feesChartData, loading, error]
}

export function useAumPerformanceData({ from = FIRST_DATE_TS, to = NOW_TS, groupPeriod }) {
  const [feesData, feesLoading] = useFeesData({ from, to, groupPeriod })
  const [glpData, glpLoading] = useGlpData({ from, to, groupPeriod })
  const [volumeData, volumeLoading] = useVolumeData({ from, to, groupPeriod })

  const dailyCoef = 86400 / groupPeriod

  const data = useMemo(() => {
    if (!feesData || !glpData || !volumeData) {
      return null
    }

    const ret = feesData.map((feeItem, i) => {
      const glpItem = glpData[i]
      const volumeItem = volumeData[i]
      let apr = (feeItem?.all && glpItem?.aum) ? feeItem.all /  glpItem.aum * 100 * 365 * dailyCoef : null
      if (apr > 10000) {
        apr = null
      }
      let usage = (volumeItem?.all && glpItem?.aum) ? volumeItem.all / glpItem.aum * 100 * dailyCoef : null
      if (usage > 10000) {
        usage = null
      }

      return {
        timestamp: feeItem.timestamp,
        apr,
        usage
      }
    })
    const averageApr = ret.reduce((memo, item) => item.apr + memo, 0) / ret.length
    ret.forEach(item => item.averageApr = averageApr)
    const averageUsage = ret.reduce((memo, item) => item.usage + memo, 0) / ret.length
    ret.forEach(item => item.averageUsage = averageUsage)
    return ret
  }, [feesData, glpData, volumeData])

  return [data, feesLoading || glpLoading || volumeLoading]
}

export function useGlpData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const timestampProp = chainName === 'arbitrum' ? 'id' : 'timestamp'
  const query = `{
    glpStats(
      first: 1000
      orderBy: ${timestampProp}
      orderDirection: desc
      where: {
        period: daily
        ${timestampProp}_gte: ${from}
        ${timestampProp}_lte: ${to}
      }
      subgraphError: allow
    ) {
      ${timestampProp}
      aumInUsdg
      glpSupply
      distributedUsd
      distributedEth
    }
  }`
  let [data, loading, error] = useGraph(query, { chainName })

  let cumulativeDistributedUsdPerGlp = 0
  let cumulativeDistributedEthPerGlp = 0
  const glpChartData = useMemo(() => {
    if (!data) {
      return null
    }

    let prevGlpSupply
    let prevAum

    let ret = sortBy(data.glpStats, item => item[timestampProp]).filter(item => item[timestampProp] % 86400 === 0).reduce((memo, item) => {
      const last = memo[memo.length - 1]

      const aum = Number(item.aumInUsdg) / 1e18
      const glpSupply = Number(item.glpSupply) / 1e18

      const distributedUsd = Number(item.distributedUsd) / 1e30
      const distributedUsdPerGlp = (distributedUsd / glpSupply) || 0
      cumulativeDistributedUsdPerGlp += distributedUsdPerGlp

      const distributedEth = Number(item.distributedEth) / 1e18
      const distributedEthPerGlp = (distributedEth / glpSupply) || 0
      cumulativeDistributedEthPerGlp += distributedEthPerGlp

      const glpPrice = aum / glpSupply
      const timestamp = parseInt(item[timestampProp])

      const newItem = {
        timestamp,
        aum,
        glpSupply,
        glpPrice,
        cumulativeDistributedEthPerGlp,
        cumulativeDistributedUsdPerGlp,
        distributedUsdPerGlp,
        distributedEthPerGlp
      }

      if (last && last.timestamp === timestamp) {
        memo[memo.length - 1] = newItem
      } else {
        memo.push(newItem)
      }

      return memo
    }, []).map(item => {
      let { glpSupply, aum } = item
      if (!glpSupply) {
        glpSupply = prevGlpSupply
      }
      if (!aum) {
        aum = prevAum
      }
      item.glpSupplyChange = prevGlpSupply ? (glpSupply - prevGlpSupply) / prevGlpSupply * 100 : 0
      if (item.glpSupplyChange > 1000) {
        item.glpSupplyChange = 0
      }
      item.aumChange = prevAum ? (aum - prevAum) / prevAum * 100 : 0
      if (item.aumChange > 1000) {
        item.aumChange = 0
      }
      prevGlpSupply = glpSupply
      prevAum = aum
      return item
    })

    ret = fillNa(ret)
    return ret
  }, [data])
  
  return [glpChartData, loading, error]
}

export function useGlpPerformanceData(glpData, feesData, { from = FIRST_DATE_TS, chainName = "arbitrum" } = {}) {
  const [btcPrices] = useCoingeckoPrices('BTC', { from })
  const [ethPrices] = useCoingeckoPrices('ETH', { from })
  const [avaxPrices] = useCoingeckoPrices('AVAX', { from })

  const glpPerformanceChartData = useMemo(() => {
    if (!btcPrices || !ethPrices || !avaxPrices || !glpData || !feesData) {
      return null
    }

    if (feesData.length == 0 || glpData.length == 0) {
      return null
    }

    const glpDataById = glpData.reduce((memo, item) => {
      memo[item.timestamp] = item
      return memo
    }, {})

    const feesDataById = feesData.reduce((memo, item) => {
      memo[item.timestamp] = item
      return memo
    })

    let BTC_WEIGHT = 0
    let ETH_WEIGHT = 0
    let AVAX_WEIGHT = 0

    if (chainName === "avalanche") {
      BTC_WEIGHT = 0.166
      ETH_WEIGHT = 0.166
      AVAX_WEIGHT = 0.166
    } else {
      BTC_WEIGHT = 0.25
      ETH_WEIGHT = 0.25
    }

    const STABLE_WEIGHT = 1 - BTC_WEIGHT - ETH_WEIGHT - AVAX_WEIGHT
    const GLP_START_PRICE = glpDataById[btcPrices[0].timestamp]?.glpPrice || 1.19

    const btcFirstPrice = btcPrices[0]?.value
    const ethFirstPrice = ethPrices[0]?.value
    const avaxFirstPrice = avaxPrices[0]?.value

    let indexBtcCount = GLP_START_PRICE * BTC_WEIGHT / btcFirstPrice
    let indexEthCount = GLP_START_PRICE * ETH_WEIGHT / ethFirstPrice
    let indexAvaxCount = GLP_START_PRICE * AVAX_WEIGHT / avaxFirstPrice
    let indexStableCount = GLP_START_PRICE * STABLE_WEIGHT

    const lpBtcCount = GLP_START_PRICE * 0.5 / btcFirstPrice
    const lpEthCount = GLP_START_PRICE * 0.5 / ethFirstPrice
    const lpAvaxCount = GLP_START_PRICE * 0.5 / avaxFirstPrice

    const ret = []
    let cumulativeFeesPerGlp = 0
    let lastGlpItem
    let lastFeesItem

    let prevEthPrice = 3400
    let prevAvaxPrice = 1000
    for (let i = 0; i < btcPrices.length; i++) {
      const btcPrice = btcPrices[i].value
      const ethPrice = ethPrices[i]?.value || prevEthPrice
      const avaxPrice = avaxPrices[i]?.value || prevAvaxPrice
      prevAvaxPrice = avaxPrice
      prevEthPrice = ethPrice

      const timestampGroup = parseInt(btcPrices[i].timestamp / 86400) * 86400
      const glpItem = glpDataById[timestampGroup] || lastGlpItem
      lastGlpItem = glpItem

      const glpPrice = glpItem?.glpPrice
      const glpSupply = glpItem?.glpSupply
      
      const feesItem = feesDataById[timestampGroup] || lastFeesItem
      lastFeesItem = feesItem

      const dailyFees = feesItem?.all

      const syntheticPrice = (
        indexBtcCount * btcPrice
        + indexEthCount * ethPrice
        + indexAvaxCount * avaxPrice
        + indexStableCount
      )

      // rebalance each day. can rebalance each X days
      if (i % 1 == 0) {
        indexBtcCount = syntheticPrice * BTC_WEIGHT / btcPrice
        indexEthCount = syntheticPrice * ETH_WEIGHT / ethPrice
        indexAvaxCount = syntheticPrice * AVAX_WEIGHT / avaxPrice
        indexStableCount = syntheticPrice * STABLE_WEIGHT
      }

      const lpBtcPrice = (lpBtcCount * btcPrice + GLP_START_PRICE / 2) * (1 + getImpermanentLoss(btcPrice / btcFirstPrice))
      const lpEthPrice = (lpEthCount * ethPrice + GLP_START_PRICE / 2) * (1 + getImpermanentLoss(ethPrice / ethFirstPrice))
      const lpAvaxPrice = (lpAvaxCount * avaxPrice + GLP_START_PRICE / 2) * (1 + getImpermanentLoss(avaxPrice / avaxFirstPrice))

      if (dailyFees && glpSupply) {
        const INCREASED_GLP_REWARDS_TIMESTAMP = 1635714000
        const GLP_REWARDS_SHARE = timestampGroup >= INCREASED_GLP_REWARDS_TIMESTAMP ? 0.7 : 0.5
        const collectedFeesPerGlp = dailyFees / glpSupply * GLP_REWARDS_SHARE
        cumulativeFeesPerGlp += collectedFeesPerGlp
      }

      let glpPlusFees = glpPrice
      if (glpPrice && glpSupply && cumulativeFeesPerGlp) {
        glpPlusFees = glpPrice + cumulativeFeesPerGlp
      }

      let glpApr
      let glpPlusDistributedUsd
      let glpPlusDistributedEth
      if (glpItem) {
        if (glpItem.cumulativeDistributedUsdPerGlp) {
          glpPlusDistributedUsd = glpPrice + glpItem.cumulativeDistributedUsdPerGlp
          // glpApr = glpItem.distributedUsdPerGlp / glpPrice * 365 * 100 // incorrect?
        }
        if (glpItem.cumulativeDistributedEthPerGlp) {
          glpPlusDistributedEth = glpPrice + glpItem.cumulativeDistributedEthPerGlp * ethPrice
        }
      }

      ret.push({
        timestamp: btcPrices[i].timestamp,
        syntheticPrice,
        lpBtcPrice,
        lpEthPrice,
        lpAvaxPrice,
        glpPrice,
        btcPrice,
        ethPrice,
        glpPlusFees,
        glpPlusDistributedUsd,
        glpPlusDistributedEth,

        indexBtcCount,
        indexEthCount,
        indexAvaxCount,
        indexStableCount,

        BTC_WEIGHT,
        ETH_WEIGHT,
        AVAX_WEIGHT,
        STABLE_WEIGHT,

        performanceLpEth: (glpPrice / lpEthPrice * 100).toFixed(2),
        performanceLpEthCollectedFees: (glpPlusFees / lpEthPrice * 100).toFixed(2),
        performanceLpEthDistributedUsd: (glpPlusDistributedUsd / lpEthPrice * 100).toFixed(2),
        performanceLpEthDistributedEth: (glpPlusDistributedEth / lpEthPrice * 100).toFixed(2),

        performanceLpBtcCollectedFees: (glpPlusFees / lpBtcPrice * 100).toFixed(2),

        performanceLpAvaxCollectedFees: (glpPlusFees / lpAvaxPrice * 100).toFixed(2),

        performanceSynthetic: (glpPrice / syntheticPrice * 100).toFixed(2),
        performanceSyntheticCollectedFees: (glpPlusFees / syntheticPrice * 100).toFixed(2),
        performanceSyntheticDistributedUsd: (glpPlusDistributedUsd / syntheticPrice * 100).toFixed(2),
        performanceSyntheticDistributedEth: (glpPlusDistributedEth / syntheticPrice * 100).toFixed(2),

        glpApr
      })
    }

    return ret
  }, [btcPrices, ethPrices, glpData, feesData])

  return [glpPerformanceChartData]
}

export function useTokenStats({ 
  from = FIRST_DATE_TS,
  to = NOW_TS,
  period = 'daily',
  chainName = "arbitrum" 
} = {}) {

  const getTokenStatsFragment = ({skip = 0} = {}) => `
    tokenStats(
      first: 1000,
      skip: ${skip},
      orderBy: timestamp,
      orderDirection: desc,
      where: { period: ${period}, timestamp_gte: ${from}, timestamp_lte: ${to} }
      subgraphError: allow
    ) {
      poolAmountUsd
      timestamp
      token
    }
  `

  // Request more than 1000 records to retrieve maximum stats for period
  const query = `{
    a: ${getTokenStatsFragment()}
    b: ${getTokenStatsFragment({skip: 1000})},
    c: ${getTokenStatsFragment({skip: 2000})},
    d: ${getTokenStatsFragment({skip: 3000})},
    e: ${getTokenStatsFragment({skip: 4000})},
    f: ${getTokenStatsFragment({skip: 5000})},
  }`

  const [graphData, loading, error] = useGraph(query, { chainName })

  const data = useMemo(() => {
    if (loading || !graphData) {
      return null;
    }

    const fullData = Object.values(graphData).reduce((memo, records) => {
      memo.push(...records);
      return memo;
    }, []);

    const retrievedTokens = new Set();

    const timestampGroups = fullData.reduce((memo, item) => {
      const {timestamp, token, ...stats} = item;

      const symbol = tokenSymbols[token] || token;

      retrievedTokens.add(symbol);

      memo[timestamp] = memo[timestamp || 0] || {};

      memo[timestamp][symbol] = {
        poolAmountUsd: parseInt(stats.poolAmountUsd) / 1e30,
      };

      return memo;
    }, {});

    const poolAmountUsdRecords = [];

    Object.entries(timestampGroups).forEach(([timestamp, dataItem]) => {
        const poolAmountUsdRecord = Object.entries(dataItem).reduce((memo, [token, stats]) => {
            memo.all += stats.poolAmountUsd;
            memo[token] = stats.poolAmountUsd;
            memo.timestamp = timestamp;

            return memo;
        }, {all: 0});

        poolAmountUsdRecords.push(poolAmountUsdRecord);
    })

    return {
      poolAmountUsd: poolAmountUsdRecords,
      tokenSymbols: Array.from(retrievedTokens),
    };
  }, [graphData, loading])

  return [data, loading, error]
}

export function useReferralsData({ from = FIRST_DATE_TS, to = NOW_TS, chainName = "arbitrum" } = {}) {
  const query = `{
    globalStats(
      first: 1000
      orderBy: timestamp
      orderDirection: desc
      where: { period: "daily", timestamp_gte: ${from}, timestamp_lte: ${to} }
      subgraphError: allow
    ) {
      volume
      volumeCumulative
      totalRebateUsd
      totalRebateUsdCumulative
      discountUsd
      discountUsdCumulative
      referrersCount
      referrersCountCumulative
      referralCodesCount
      referralCodesCountCumulative
      referralsCount
      referralsCountCumulative
      timestamp
    }
  }`
  const subgraph = chainName === "arbitrum"
    ? "gmx-io/gmx-arbitrum-referrals"
    : "gmx-io/gmx-avalanche-referrals"
  const [graphData, loading, error] = useGraph(query, { subgraph })

  
  const data = graphData ? sortBy(graphData.globalStats, 'timestamp').map(item => {
    const totalRebateUsd = item.totalRebateUsd / 1e30
    const discountUsd = item.discountUsd / 1e30
    return {
      ...item,
      volume: item.volume / 1e30,
      volumeCumulative: item.volumeCumulative / 1e30,
      totalRebateUsd,
      totalRebateUsdCumulative: item.totalRebateUsdCumulative / 1e30,
      discountUsd,
      referrerRebateUsd: totalRebateUsd - discountUsd,
      discountUsdCumulative: item.discountUsdCumulative / 1e30,
      referralCodesCount: parseInt(item.referralCodesCount),
      referralCodesCountCumulative: parseInt(item.referralCodesCountCumulative),
      referrersCount: parseInt(item.referrersCount),
      referrersCountCumulative: parseInt(item.referrersCountCumulative),
      referralsCount: parseInt(item.referralsCount),
      referralsCountCumulative: parseInt(item.referralsCountCumulative),
    }
  }) : null

  return [data, loading, error]
}
