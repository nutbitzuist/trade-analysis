//+------------------------------------------------------------------+
//|                                                    TradeSync.mq4 |
//|                                        Trade Analysis EA v1.0    |
//|                          Syncs trades to Trade Analysis Web App  |
//+------------------------------------------------------------------+
#property copyright "Trade Analysis"
#property link      ""
#property version   "1.00"
#property strict

//--- Input parameters
input string   ServerURL = "https://tradeanalysis.up.railway.app/api/sync";  // Server URL
input string   ApiKey = "";                                    // API Key from Web App
input int      SyncIntervalSeconds = 30;                       // Sync interval in seconds
input bool     SyncOpenTrades = true;                          // Sync open trades
input bool     SyncClosedTrades = true;                        // Sync closed (history) trades
input int      HistoryDays = 30;                               // Days of history to sync

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
      Alert("TradeSync: Please enter your API Key in the EA settings!");
      return(INIT_PARAMETERS_INCORRECT);
   }
   
   Print("TradeSync EA initialized. Server: ", ServerURL);
   Print("Sync interval: ", SyncIntervalSeconds, " seconds");
   
   // Initial sync
   SyncTrades();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                   |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   Print("TradeSync EA stopped. Total syncs: ", syncCount);
}

//+------------------------------------------------------------------+
//| Expert tick function                                               |
//+------------------------------------------------------------------+
void OnTick()
{
   // Check if it's time to sync
   if(TimeCurrent() - lastSyncTime >= SyncIntervalSeconds)
   {
      SyncTrades();
      lastSyncTime = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| Timer function (alternative to OnTick for more reliable timing)    |
//+------------------------------------------------------------------+
void OnTimer()
{
   SyncTrades();
}

//+------------------------------------------------------------------+
//| Main sync function                                                 |
//+------------------------------------------------------------------+
void SyncTrades()
{
   string jsonData = BuildJsonPayload();
   
   if(StringLen(jsonData) == 0)
   {
      Print("TradeSync: No data to sync");
      return;
   }
   
   string result = SendHttpRequest(jsonData);
   
   if(StringLen(result) > 0)
   {
      syncCount++;
      Print("TradeSync: Sync #", syncCount, " completed successfully");
   }
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
   json += "\"balance\":" + DoubleToString(AccountBalance(), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountEquity(), 2) + ",";
   json += "\"margin\":" + DoubleToString(AccountMargin(), 2) + ",";
   json += "\"free_margin\":" + DoubleToString(AccountFreeMargin(), 2);
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
            // Only include actual trades (not pending orders for now)
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
            // Only include actual trades (not cancelled pending orders)
            if(OrderType() == OP_BUY || OrderType() == OP_SELL)
            {
               // Check if within date range
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
//| Send HTTP POST request                                             |
//+------------------------------------------------------------------+
string SendHttpRequest(string jsonData)
{
   string headers = "Content-Type: application/json\r\n";
   char post[];
   char result[];
   string resultHeaders;
   
   // Convert string to char array
   StringToCharArray(jsonData, post, 0, StringLen(jsonData));
   
   // Reset error
   ResetLastError();
   
   // Send request
   int res = WebRequest(
      "POST",           // Method
      ServerURL,        // URL
      headers,          // Headers
      5000,             // Timeout (ms)
      post,             // POST data
      result,           // Result data
      resultHeaders     // Result headers
   );
   
   if(res == -1)
   {
      int error = GetLastError();
      
      if(error == 4060)
      {
         Print("TradeSync Error: URL not allowed. Please add '", ServerURL, "' to allowed URLs in MT4:");
         Print("Go to Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL");
         Alert("TradeSync: Please add server URL to allowed URLs in MT4 settings!");
      }
      else
      {
         Print("TradeSync Error: WebRequest failed. Error code: ", error);
      }
      
      return "";
   }
   
   if(res != 200)
   {
      Print("TradeSync Error: Server returned status ", res);
      Print("Response: ", CharArrayToString(result));
      return "";
   }
   
   return CharArrayToString(result);
}

//+------------------------------------------------------------------+
//| Chart event handler (for manual sync button if needed)             |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   // Can be extended to add manual sync button on chart
}
//+------------------------------------------------------------------+
