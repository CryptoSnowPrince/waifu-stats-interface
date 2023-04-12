export const BSC = 56
export const ARBITRUM = 42161
export const AVALANCHE = 43114

export const addresses = {
    [BSC]: {
        Vault: "0xc73A8DcAc88498FD4b4B1b2AaA37b0a2614Ff67B",
        Router: "0xD46B23D042E976F8666F554E928e0Dc7478a8E1f",
        USDG: "0x85E76cbf4893c1fbcB34dCF1239A91CE2A4CF5a7",
        Stabilize: "0x82C4841728fBd5e08A77A95cA3192BcE1F645Ee9",
        WardenSwapRouter: "0x7A1Decf6c24232060F4D76A33a317157549C2093",
        OneInchRouter: "0x11111112542D85B3EF69AE05771c2dCCff4fAa26",
        DodoexRouter: "0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486",
        MetamaskRouter: "0x1a1ec25DC08e98e5E93F1104B5e5cdD298707d31"
    },

    [ARBITRUM]: {
        GMX: '0x67C8a2b3C511da2ED28159ab90aa2444870B4F51',
        BTC: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
        ETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
        // LINK: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4',
        // UNI: '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0',
        ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        // DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
        USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        RewardReader: '0x1801eF634401c136A33D720d82F6d90DfD46790b',
        GLP: '0x92dB07d5dd0C67e074CAc7387F7eC552dED6D290',
        GlpManager: '0x8B874c68d616041bE930d10aE40aC2F30ed03afE'
    },

    [AVALANCHE]: {
        GMX: '0x39E1Da9a034Fd5ADba01C7F6cFA8B5dE16dD908c',
        AVAX: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
        ETH: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
        BTC: '0x50b7545627a5162f82a992c33b87adc75187b218',
        RewardReader: '0x04Fc11Bd28763872d143637a7c768bD96E44c1b6',
        GLP: '0xA63FbC76dDaf2F800B3699a4a46C5f260E04050C',
        GlpManager: '0x3a417b2949d59B129e5C6c0A52114335C780B9AE'
    }
}

export function getAddress(chainId, key) {
    if (!(chainId) in addresses) {
        throw new Error(`Unknown chain ${chainId}`)
    }
    if (!(key in addresses[chainId])) {
        throw new Error(`Unknown address key ${key}`)
    }
    return addresses[chainId][key]
}
