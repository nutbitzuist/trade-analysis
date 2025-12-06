//+------------------------------------------------------------------+
//|                                                TradeSyncFile.mq4 |
//|                                        Trade Analysis EA v1.0    |
//|              Writes trades to file for bridge script to process  |
//+------------------------------------------------------------------+
#property copyright "Trade Analysis"
#property link      ""
#property version   "1.00"
#property strict

//--- Input parameters
input string   ApiKey = "";                                    // API Key from Web App
input int      SyncIntervalSeconds = 30;                       // Sync interval in seconds
input bool     SyncOpenTrades = true;                          // Sync open trades
input bool     SyncClosedTrades = true;                        // Sync closed (history) trades
input int      HistoryDays = 30;                               // Days of history to sync
input string   OutputFolder = "TradeSync";                     // Folder name in MQL4/Files

//--- Global variables
datetime lastSyncTime = 0;
int syncCount = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(ApiKey) == 0)
   {
      Alert("TradeSyncFile: Please enter your API Key in the EA settings!");
      return(INIT_PARAMETERS_INCORRECT);
   }
   
   // Create output folder
   FolderCreate(OutputFolder);
   
   Print("TradeSyncFile EA initialized.");
   Print("Output folder: MQL4/Files/", OutputFolder);
   Print("Sync interval: ", SyncIntervalSeconds, " seconds");
   
   // Initial sync
   WriteTradesToFile();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                   |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("TradeSyncFile EA stopped. Total syncs: ", syncCount);
}

//+------------------------------------------------------------------+
//| Expert tick function                                               |
//+------------------------------------------------------------------+
void OnTick()
{
   // Check if it's time to sync
   if(TimeCurrent() - lastSyncTime >= SyncIntervalSeconds)
   {
      WriteTradesToFile();
      lastSyncTime = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| Write trades to JSON file                                          |
//+------------------------------------------------------------------+
void WriteTradesToFile()
{
   string filename = OutputFolder + "/trades_" + ApiKey + ".json";
   
   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_ANSI);
   
   if(handle == INVALID_HANDLE)
   {
      Print("TradeSyncFile Error: Cannot open file for writing. Error: ", GetLastError());
      return;
   }
   
   string json = BuildJsonPayload();
   FileWriteString(handle, json);
   FileClose(handle);
   
   // Write a flag file to signal new data is ready
   string flagFile = OutputFolder + "/ready_" + ApiKey + ".flag";
   int flagHandle = FileOpen(flagFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(flagHandle != INVALID_HANDLE)
   {
      FileWriteString(flagHandle, TimeToString(TimeCurrent()));
      FileClose(flagHandle);
   }
   
   syncCount++;
   Print("TradeSyncFile: Sync #", syncCount, " - Data written to file");
}

//+------------------------------------------------------------------+
//| Build JSON payload with account info and trades                    |
//+------------------------------------------------------------------+
string BuildJsonPayload()
{
   string json = "{";
   
   // API Key
   json += "\"api_key\":\"" + ApiKey + "\",";
   
   // Account Info
   json += "\"account_info\":{";
   json += "\"account_number\":" + IntegerToString(AccountNumber()) + ",";
   json += "\"balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountEquity(), 2) + ",";
   json += "\"margin\":" + DoubleToString(AccountMargin(), 2) + ",";
   json += "\"free_margin\":" + DoubleToString(AccountFreeMargin(), 2) + ",";
   json += "\"leverage\":" + IntegerToString(AccountLeverage()) + ",";
   json += "\"currency\":\"" + AccountCurrency() + "\",";
   json += "\"broker\":\"" + AccountCompany() + "\",";
   json += "\"server\":\"" + AccountServer() + "\"";
   json += "},";
   
   // Trades array
   json += "\"trades\":[";
   
   bool firstTrade = true;
   
   // Open trades
   if(SyncOpenTrades)
   {
      for(int i = 0; i < OrdersTotal(); i++)
      {
         if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         {
            if(OrderType() == OP_BUY || OrderType() == OP_SELL)
            {
               if(!firstTrade) json += ",";
               json += BuildTradeJson(false);
               firstTrade = false;
            }
         }
      }
   }
   
   // Closed trades (history)
   if(SyncClosedTrades)
   {
      datetime fromDate = TimeCurrent() - (HistoryDays * 24 * 60 * 60);
      
      for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
      {
         if(OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         {
            if(OrderType() == OP_BUY || OrderType() == OP_SELL)
            {
               if(OrderCloseTime() >= fromDate)
               {
                  if(!firstTrade) json += ",";
                  json += BuildTradeJson(true);
                  firstTrade = false;
               }
            }
         }
      }
   }
   
   json += "]}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON for a single trade                                      |
//+------------------------------------------------------------------+
string BuildTradeJson(bool isClosed)
{
   string json = "{";
   
   json += "\"ticket\":" + IntegerToString(OrderTicket()) + ",";
   json += "\"symbol\":\"" + OrderSymbol() + "\",";
   json += "\"type\":\"" + GetOrderTypeString(OrderType()) + "\",";
   json += "\"lots\":" + DoubleToString(OrderLots(), 2) + ",";
   json += "\"open_price\":" + DoubleToString(OrderOpenPrice(), (int)MarketInfo(OrderSymbol(), MODE_DIGITS)) + ",";
   
   if(isClosed)
   {
      json += "\"close_price\":" + DoubleToString(OrderClosePrice(), (int)MarketInfo(OrderSymbol(), MODE_DIGITS)) + ",";
      json += "\"close_time\":\"" + TimeToString(OrderCloseTime(), TIME_DATE|TIME_SECONDS) + "\",";
   }
   else
   {
      json += "\"close_price\":null,";
      json += "\"close_time\":null,";
   }
   
   json += "\"stop_loss\":" + DoubleToString(OrderStopLoss(), (int)MarketInfo(OrderSymbol(), MODE_DIGITS)) + ",";
   json += "\"take_profit\":" + DoubleToString(OrderTakeProfit(), (int)MarketInfo(OrderSymbol(), MODE_DIGITS)) + ",";
   json += "\"open_time\":\"" + TimeToString(OrderOpenTime(), TIME_DATE|TIME_SECONDS) + "\",";
   json += "\"commission\":" + DoubleToString(OrderCommission(), 2) + ",";
   json += "\"swap\":" + DoubleToString(OrderSwap(), 2) + ",";
   json += "\"profit\":" + DoubleToString(OrderProfit(), 2) + ",";
   json += "\"magic_number\":" + IntegerToString(OrderMagicNumber()) + ",";
   json += "\"comment\":\"" + EscapeJsonString(OrderComment()) + "\"";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Convert order type to string                                       |
//+------------------------------------------------------------------+
string GetOrderTypeString(int orderType)
{
   switch(orderType)
   {
      case OP_BUY:       return "BUY";
      case OP_SELL:      return "SELL";
      case OP_BUYLIMIT:  return "BUY_LIMIT";
      case OP_SELLLIMIT: return "SELL_LIMIT";
      case OP_BUYSTOP:   return "BUY_STOP";
      case OP_SELLSTOP:  return "SELL_STOP";
      default:           return "UNKNOWN";
   }
}

//+------------------------------------------------------------------+
//| Escape special characters in JSON string                           |
//+------------------------------------------------------------------+
string EscapeJsonString(string text)
{
   string result = text;
   StringReplace(result, "\\", "\\\\");
   StringReplace(result, "\"", "\\\"");
   StringReplace(result, "\n", "\\n");
   StringReplace(result, "\r", "\\r");
   StringReplace(result, "\t", "\\t");
   return result;
}
//+------------------------------------------------------------------+
