import { reactive } from "vue"
import useHttpService from "@/composables/useHttpService"
import useLocalStorage from "@/composables/useLocalStorage"
import useStorage from "@/composables/useStorage"
import type { TCryptoData, TCryptoDefaultStates, TEntryCryptoData } from "@/stores/crypto.types"
import { sorter } from "@/utils/sorters"
import { LOCALSTORAGE_CRYPTO_CURRENCY, LOCALSTORAGE_CRYPTO_FAVORITES } from "@/app.storages"

const URL_API = "https://api.coingecko.com/api/v3"
const DB_NAME = "crypto"
const CRYPTO_CACHE_KEY = "crypto_cache"
const CRYPTO_CURRENCIES_CACHE_KEY = "currencies_cache"
const CRYPTO_MARKETS_CACHE_KEY = "markets"
const PER_PAGE = 250

const state: TCryptoDefaultStates = reactive({
  cryptoList: new Map(),
  currenciesList: [],
  currentList: [],
  currencyActive: "eur",
  categoryActive: null,
  cryptoFavorites: new Map(),
  filterIds: [],
  isReadyCryptoStore: 0,
  currentOrder: "market_cap_desc",
  currentPage: 1,
})

export const useCryptoStore = () => {
  const fetchCurrenciesList = async () => {
    const cacheCurrencies = await useStorage.get(DB_NAME, CRYPTO_CURRENCIES_CACHE_KEY)
    if (cacheCurrencies && cacheCurrencies.length) {
      state.currenciesList = cacheCurrencies
    } else {
      const data = await useHttpService.get(`${URL_API}/simple/supported_vs_currencies`)
      if (data && data.length) state.currenciesList = data
      await useStorage.set(DB_NAME, CRYPTO_CURRENCIES_CACHE_KEY, data)
    }
    state.isReadyCryptoStore += 1
  }

  const fetchCryptoList = async () => {
    const cacheCryptoList = await useStorage.get(DB_NAME, CRYPTO_CACHE_KEY)
    if (cacheCryptoList && cacheCryptoList.length) {
      cacheCryptoList.forEach(([index, e]: [index: string, e: TCryptoData]) => {
        state.cryptoList.set(index, e)
      })
    } else {
      const data = await useHttpService.get(`${URL_API}/coins/list`)
      if (data && data.length)
        for (const e of data) {
          state.cryptoList.set(e.id, { ...e, pricesByCurrencies: {} })
        }
      await useStorage.set(DB_NAME, CRYPTO_CACHE_KEY, Array.from(state.cryptoList))
    }
    state.isReadyCryptoStore += 1
  }

  const fetchCryptosInfos = async (ids: string[] = []) => {
    const query: any = {
      vs_currency: state.currencyActive,
      per_page: PER_PAGE,
      page: state.currentPage,
      include_24h_vol: true,
      include_24hr_change: true,
      include_last_updated_at: true,
      sparkline: true,
      order: state.currentOrder,
    }
    const idsToFetch = [...state.filterIds, ...ids]
    if (idsToFetch.length > 0) {
      query.ids = idsToFetch.join(",")
    }

    if (idsToFetch.length > 0 && idsToFetch.length <= 250) {
      let hasError = false
      const items: any[] = idsToFetch.map((id) => {
        const item = state.cryptoList.get(id)
        if (!item || !item.image) {
          hasError = true
        }
        return item
      })
      if (!hasError) {
        items.sort(sorter(state.currentOrder))
        if (state.currentOrder.indexOf("desc") !== -1) items.reverse()
        state.currentList = items
        return true
      }
    }

    const cacheKey = `${CRYPTO_MARKETS_CACHE_KEY}_${state.currencyActive}_${state.currentOrder}_${state.currentPage}${
      query.ids ? `_${query.ids}` : ""
    }`
    const cacheData = await useStorage.get(DB_NAME, cacheKey)
    let data = null

    if (cacheData) {
      data = cacheData
    } else {
      data = await useHttpService.get(`${URL_API}/coins/markets`, query)
      if (data) {
        await useStorage.set(DB_NAME, cacheKey, data)
      } else {
        return false
      }
    }

    if (data) {
      state.currentList = state.currentPage === 1 ? data : [...state.currentList, ...data]
      const responseArray: TEntryCryptoData[] = Object.values(data)
      if (responseArray.length) {
        responseArray.map((value) => {
          const key = value.id
          const item = state.cryptoList.get(key)
          if (item) {
            item.image = value.image
            item.sparkline_in_7d = value.sparkline_in_7d.price
            item.pricesByCurrencies[state.currencyActive] = {
              current_price: value.current_price,
              market_cap: value.market_cap,
              total_volume: value.total_volume,
              price_change_24h: value.price_change_24h,
            }
            state.cryptoList.set(key, item)
            if (state.cryptoFavorites.get(key)) state.cryptoFavorites.set(key, item)
          }
        })
        await useStorage.set(DB_NAME, CRYPTO_CACHE_KEY, Array.from(state.cryptoList))
      }
    }

    return true
  }

  const setSort = (order: string, direction: string) => {
    if (order !== "market_cap" && order !== "volume" && order !== "id") return
    if (direction !== "asc" && direction !== "desc") return
    state.currentOrder = `${order}_${direction}`
    state.currentPage = 1
  }

  const filterByName = async (name: string) => {
    if (!name) {
      state.filterIds = []
      return
    }
    state.filterIds = (await useHttpService.get(`${URL_API}/search?query=${name}`)).coins.map((coin: any) => coin.id)
  }

  const filterByIds = (ids: string[]) => {
    if (ids.length === 0) {
      state.filterIds = []
      return
    }
    const tmp: string[] = []
    ids.forEach((id) => {
      if (state.cryptoList.has(id)) {
        tmp.push(id)
      }
    })
    state.filterIds = tmp
  }

  const setPage = (page: number) => {
    state.currentPage = page
  }

  const nextPage = () => {
    state.currentPage += 1
  }

  const getCurrencyActive = () => {
    const currency = useLocalStorage.get(LOCALSTORAGE_CRYPTO_CURRENCY)
    state.currencyActive = currency || "eur"
  }

  const setCurrencyActive = (currency: string) => {
    state.currencyActive = currency
    useLocalStorage.set(LOCALSTORAGE_CRYPTO_CURRENCY, state.currencyActive)
  }

  const getFavorites = async () => {
    const favourites = useLocalStorage.get(LOCALSTORAGE_CRYPTO_FAVORITES)
    if (favourites && favourites.length) {
      favourites.forEach(([index, e]: [index: string, e: TCryptoData]) => {
        state.cryptoFavorites.set(index, e)
      })
    }
  }

  const addFavorite = async (crypto: any) => {
    state.cryptoFavorites.set(crypto.id, {
      id: crypto.id,
      name: crypto.name,
      symbol: crypto.name,
      pricesByCurrencies: {},
    })
    useLocalStorage.set(LOCALSTORAGE_CRYPTO_FAVORITES, Array.from(state.cryptoFavorites))
  }

  const removeFavorite = async (crypto: any) => {
    state.cryptoFavorites.delete(crypto.id)
    useLocalStorage.set(LOCALSTORAGE_CRYPTO_FAVORITES, Array.from(state.cryptoFavorites))
  }

  return {
    state,
    getCurrencyActive,
    fetchCurrenciesList,
    fetchCryptoList,
    fetchCryptosInfos,
    setSort,
    filterByName,
    filterByIds,
    setPage,
    nextPage,
    setCurrencyActive,
    getFavorites,
    addFavorite,
    removeFavorite,
  }
}
