import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { encodeAddress } from '@polkadot/keyring';
import BN from 'bn.js';
import Rmrk_factory from '../types/constructors/shiden34';
import Rmrk from '../types/contracts/shiden34';

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { ReturnNumber } from '@727-ventures/typechain-types';

use(chaiAsPromised);

const MAX_SUPPLY = 888;
const BASE_URI = "ipfs://tokenUriPrefix/";
const COLLECTION_METADATA = "ipfs://collectionMetadata/data.json";
const TOKEN_URI_1 = "ipfs://tokenUriPrefix/1.json";
const TOKEN_URI_5 = "ipfs://tokenUriPrefix/5.json";
const ONE = new BN(1).pow(new BN(1));
const PRICE_PER_MINT = ONE;

// Create a new instance of contract
const wsProvider = new WsProvider('ws://127.0.0.1:9944');
// Create a keyring instance
const keyring = new Keyring({ type: 'sr25519' });

describe('Minting psp34 tokens', () => {
  let rmrkFactory: Rmrk_factory;
  let api: ApiPromise;
  let deployer: KeyringPair;
  let bob: KeyringPair;
  let contract: Rmrk;

  const gasLimit = 18750000000;
  const ZERO_ADDRESS = encodeAddress(
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  );
  let gasRequired: bigint;

  async function setup(): Promise<void> {
    api = await ApiPromise.create({ provider: wsProvider });
    deployer = keyring.addFromUri('//Alice');
    bob = keyring.addFromUri('//Bob');
    rmrkFactory = new Rmrk_factory(api, deployer);
    contract = new Rmrk((await rmrkFactory.new(
      ["Shiden34"],
      ['SH34'],
      [BASE_URI],
      MAX_SUPPLY,
      PRICE_PER_MINT,
    )).address, deployer, api);
  }

  it('Create collection works', async () => {
    await setup();
    const queryList = await contract.query;
    expect((await contract.query.totalSupply()).value.unwrap().toNumber()).to.equal(0);
    expect((await contract.query.owner()).value.ok).to.equal(deployer.address);
    expect((await contract.query.maxSupply()).value.ok).to.equal(MAX_SUPPLY);
    expect((await contract.query.price()).value.unwrap().toString()).to.equal(PRICE_PER_MINT.toString());
    const collectionId = (await contract.query.collectionId()).value.ok.bytes;

    // expect((await contract.query.getAttribute({u128: parseInt(collectionId)}, ["baseUri"])).value).to.equal(BASE_URI);
    // expect((await contract.query.getAttribute(collectionId, ["baseUri"])).value).to.equal(BASE_URI);
  })

  it('Use mintNext works', async () => {
    await setup();
    const tokenId = 1;

    expect((await contract.query.totalSupply()).value.unwrap().toNumber()).to.equal(0);

    // mint
    const gasRequired = (await contract.withSigner(bob).query.mintNext()).gasRequired;
    let mintResult = await contract.withSigner(bob).tx.mintNext({ value: PRICE_PER_MINT, gasLimit: gasRequired });

    // verify minting results. The totalSupply value is BN
    expect((await contract.query.totalSupply()).value.unwrap().toNumber()).to.equal(1);
    expect((await contract.query.balanceOf(bob.address)).value.ok).to.equal(1);
    expect((await contract.query.ownerOf({ u64: tokenId })).value.ok).to.equal(bob.address);
    emit(mintResult, 'Transfer', { from: null, to: bob.address, id: { u64: tokenId }, });

    // TODO verify tokenUri call
    // console.log("tokenUri", (await contract.query.tokenUri(1)).value);
    // expect((await contract.query.tokenUri(1))).to.equal(TOKEN_URI_1);
  })

  it('Mint 3 tokens works', async () => {
    const tokenMintNumber = 3;
    await setup();

    expect((await contract.query.totalSupply()).value.unwrap().toNumber()).to.equal(0);

    const gasRequiredMaxAmount = (await contract.withSigner(bob).query.setMaxMintAmount(tokenMintNumber)).gasRequired;
    await contract.withSigner(deployer).tx.setMaxMintAmount(tokenMintNumber, { gasLimit: gasRequiredMaxAmount });


    const gasRequired = (await contract.withSigner(bob).query.mint(bob.address, tokenMintNumber + 10)).gasRequired;
    // @ts-ignore
    await contract.withSigner(bob).tx.mint(bob.address, tokenMintNumber, { value: PRICE_PER_MINT.muln(tokenMintNumber), gasLimit: gasRequired });

    expect((await contract.query.totalSupply()).value.unwrap().toNumber()).to.equal(tokenMintNumber);
    expect((await contract.query.ownerOf({ u64: tokenMintNumber })).value.ok).to.equal(bob.address);
  })

  it('Token transfer works', async () => {
    await setup();

    // Bob mints
    let { gasRequired } = await contract.withSigner(bob).query.mintNext();
    let mintResult = await contract.withSigner(bob).tx.mintNext({ value: PRICE_PER_MINT, gasLimit: gasRequired });
    emit(mintResult, 'Transfer', { from: null, to: bob.address, id: { u64: 1 }, });

    // Bob transfers token to Deployer
    const transferGas = (await contract.withSigner(bob).query.transfer(deployer.address, { u64: 1 }, [])).gasRequired;
    let transferResult = await contract.withSigner(bob).tx.transfer(deployer.address, { u64: 1 }, [], { gasLimit: transferGas });

    // Verify transfer
    expect((await contract.query.ownerOf({ u64: 1 })).value.ok).to.equal(deployer.address);
    expect((await contract.query.balanceOf(bob.address)).value.ok).to.equal(0);
    emit(transferResult, 'Transfer', { from: bob.address, to: deployer.address, id: { u64: 1 }, });
  })

  it('Token approval works', async () => {
    await setup();

    // Bob mints
    let { gasRequired } = await contract.withSigner(bob).query.mintNext();
    await contract.withSigner(bob).tx.mintNext({ value: PRICE_PER_MINT, gasLimit: gasRequired });

    // Bob approves deployer to be operator of the token
    const approveGas = (await contract.withSigner(bob).query.approve(deployer.address, { u64: 1 }, true)).gasRequired;
    let approveResult = await contract.withSigner(bob).tx.approve(deployer.address, { u64: 1 }, true, { gasLimit: approveGas });

    // Verify that Bob is still the owner and allowance is set
    expect((await contract.query.ownerOf({ u64: 1 })).value.ok).to.equal(bob.address);
    expect((await contract.query.allowance(bob.address, deployer.address, { u64: 1 })).value.ok).to.equal(true);
    emit(approveResult, 'Approval', { from: bob.address, to: deployer.address, id: { u64: 1 }, approved: true, });
  })

  it('Minting token without funds should fail', async () => {
    await setup();

    // Bob tries to mint without funding
    let mintResult = await contract.withSigner(bob).query.mintNext();
    expect(hex2a(mintResult.value.ok.err.custom)).to.be.equal('BadMintValue');
  })
})

// Helper function to parse Events
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emit(result: { events?: any }, name: string, args: any): void {
  const event = result.events.find(
    (event: { name: string }) => event.name === name,
  );
  for (const key of Object.keys(event.args)) {
    if (event.args[key] instanceof ReturnNumber) {
      event.args[key] = event.args[key].toNumber();
    }
  }
  expect(event).eql({ name, args, });
}

// Helper function to convert error code to string
function hex2a(psp34CustomError: any): string {
  var hex = psp34CustomError.toString(); //force conversion
  var str = '';
  for (var i = 0; i < hex.length; i += 2)
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return str.substring(1);
}