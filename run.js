const { ethers } = require("ethers");
const axiosBase = require("axios");
const readline = require("readline");
const dotenv = require("dotenv");
const userAgent = require("random-useragent");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

dotenv.config();

const RPC = "https://testnet.riselabs.xyz/";
const provider = new ethers.providers.JsonRpcProvider(RPC);
const privateKeys = process.env.PRIVATE_KEY.split(',');
if (!privateKeys.length) throw new Error('No private keys found');

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const TOKEN_CONFIG = {
  "0x6F6f570F45833E249e27022648a26F4076F48f78": { name: "PEPE", decimals: 18, reserve: 0.1 },
  "0x99dBE4AEa58E518C50a1c04aE9b48C9F6354612f": { name: "MOG", decimals: 18, reserve: 0.2 },
  "0xd6e1afe5cA8D00A2EFC01B89997abE2De47fdfAf": { name: "RISE", decimals: 18, reserve: 0.1 },
  "0xF32D39ff9f6Aa7a7A64d7a4F00a54826Ef791a55": { name: "WBTC", decimals: 8, reserve: 0.15 },
  "0x40918Ba7f132E0aCba2CE4de4c4baF9BD2D7D849": { name: "USDT", decimals: 6, reserve: 0.3 },
  "0x8A93d247134d91e0de6f96547cB0204e5BE8e5D8": { name: "USDC", decimals: 6, reserve: 0.3 }
};

const GAS_CONFIG = {
  gasLimit: 269910,
  maxPriorityFeePerGas: ethers.BigNumber.from("2"),
  maxFeePerGas: ethers.BigNumber.from("11")
};

const jar = new CookieJar();
const axios = wrapper(axiosBase.create({
  jar,
  headers: {
    'User-Agent': userAgent.getRandom(),
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://dodoex.io',
    'Referer': 'https://dodoex.io/',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive'
  }
}));

function getRandomWallet() {
  const randomIndex = Math.floor(Math.random() * privateKeys.length);
  return new ethers.Wallet(privateKeys[randomIndex], provider);
}

async function getSafeSellAmount(tokenAddress, currentBalance) {
  const config = TOKEN_CONFIG[tokenAddress];
  const reserveAmount = currentBalance.mul(Math.floor(config.reserve * 1000)).div(1000);
  return currentBalance.sub(reserveAmount);
}

async function getSafeBuyAmount(ethBalance) {
  const minReserveETH = ethers.utils.parseEther("0.005");
  const availableETH = ethBalance.sub(minReserveETH);
  const buyPercentage = Math.random() * 0.2 + 0.1;
  return availableETH.mul(Math.floor(buyPercentage * 1000)).div(1000);
}

let loadingInterval;
const spinnerFrames = ['⡆', '⡇', '⡏', '⡟', '⡿', '⣟', '⣯', '⣷'];

function startLoading(message) {
  let i = 0;
  process.stdout.write("\x1B[?25l");
  loadingInterval = setInterval(() => {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`\x1b[36m${spinnerFrames[i]} \x1b[0m${message}`);
    i = (i + 1) % spinnerFrames.length;
  }, 150);
}

function stopLoading() {
  clearInterval(loadingInterval);
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write("\x1B[?25h");
}

async function executeSwap(wallet, fromToken, toToken, amount) {
  try {
    startLoading(`[${wallet.address.slice(0,6)}] Mengambil rute terbaik`);
    const params = {
      chainId: 11155931,
      deadLine: Math.floor(Date.now() / 1000) + 600,
      apikey: "a37546505892e1a952",
      slippage: 5.0,
      source: "dodoV2AndMixWasm",
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      userAddr: wallet.address,
      fromAmount: amount.toString()
    };

    const { data } = await axios.get("https://api.dodoex.io/route-service/v2/widget/getdodoroute", { params });
    if (!data?.data) throw new Error("Gagal mendapatkan rute swap");

    stopLoading();
    console.log(`\n📊 [${wallet.address.slice(0,6)}] Estimasi Return: ${data.data.resAmount}`);

    if (fromToken !== ETH_ADDRESS) {
      startLoading(`[${wallet.address.slice(0,6)}] Memeriksa allowance`);
      const token = new ethers.Contract(fromToken, [
        "function allowance(address, address) view returns (uint256)",
        "function approve(address, uint256) returns (bool)"
      ], wallet);

      const allowance = await token.allowance(wallet.address, data.data.to);
      if (allowance.lt(amount)) {
        stopLoading();
        startLoading(`[${wallet.address.slice(0,6)}] Approving...`);
        const tx = await token.approve(data.data.to, ethers.constants.MaxUint256, GAS_CONFIG);
        await tx.wait();
      }
      stopLoading();
    }

    startLoading(`[${wallet.address.slice(0,6)}] Mengirim transaksi`);
    const tx = await wallet.sendTransaction({
      to: data.data.to,
      data: data.data.data,
      value: fromToken === ETH_ADDRESS ? amount : 0,
      ...GAS_CONFIG
    });

    const receipt = await tx.wait();
    console.log(`\n✅ [${wallet.address.slice(0,6)}] Berhasil! Hash: ${tx.hash}`);
    return true;

  } catch (error) {
    stopLoading();
    console.log(`\n❌ [${wallet.address.slice(0,6)}] Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("\n🔥 DODO AutoSwap v3 - Multi Wallet Edition 🔥\n");
  console.log(`🔄 Total wallet terdeteksi: ${privateKeys.length}`);

  while (true) {
    const wallet = getRandomWallet();
    try {
      console.log(`\n══════════════════════════════════════`);
      console.log(`💼 Menggunakan wallet: ${wallet.address}`);

      const ethBalance = await provider.getBalance(wallet.address);
      console.log(`\x1b[33m💎 ETH Balance: ${ethers.utils.formatEther(ethBalance)}\x1b[0m`);

      if (ethBalance.lt(ethers.utils.parseEther("0.005"))) {
        console.log("\x1b[31m🛑 Saldo ETH kritis, beralih wallet...\x1b[0m");
        continue;
      }

      const tokens = Object.keys(TOKEN_CONFIG);
      const targetToken = tokens[Math.floor(Math.random() * tokens.length)];
      const isBuy = Math.random() > 0.5;

      if (isBuy) {
        const safeAmount = await getSafeBuyAmount(ethBalance);
        if (safeAmount.lte(0)) {
          console.log("\x1b[90m⏭️ Saldo ETH tidak cukup untuk swap + reserve\x1b[0m");
          continue;
        }

        console.log(`\n🛒 Membeli ${TOKEN_CONFIG[targetToken].name} dengan ${ethers.utils.formatEther(safeAmount)} ETH`);
        await executeSwap(wallet, ETH_ADDRESS, targetToken, safeAmount);

      } else {
        const tokenContract = new ethers.Contract(targetToken,
          ["function balanceOf(address) view returns (uint256)"], provider);
        const balance = await tokenContract.balanceOf(wallet.address);

        if (balance.lte(0)) {
          console.log(`\x1b[90m⏭️ Saldo ${TOKEN_CONFIG[targetToken].name} kosong\x1b[0m`);
          continue;
        }

        const safeAmount = await getSafeSellAmount(targetToken, balance);
        if (safeAmount.lte(0)) {
          console.log(`\x1b[90m⏭️ Saldo ${TOKEN_CONFIG[targetToken].name} kurang dari reserve\x1b[0m`);
          continue;
        }

        console.log(`\n💰 Menjual ${ethers.utils.formatUnits(safeAmount, TOKEN_CONFIG[targetToken].decimals)} ${TOKEN_CONFIG[targetToken].name}`);
        await executeSwap(wallet, targetToken, ETH_ADDRESS, safeAmount);
      }

      const delay = Math.floor(Math.random() * 21 + 32);
      console.log(`\n⌛ Jeda ${delay} detik...`);
      await new Promise(resolve => setTimeout(resolve, delay * 1000));

    } catch (error) {
      console.log(`\n⚠️ Error Global: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

main().catch(console.error);
