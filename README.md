# AgriChain

This repository contains the code for an Agricultural Supply Chain Dapp With Micro-Finance functionality, coded using Truffle and Solidity. The backend blockchain is a private ethereum network setup using Geth(go-ethereum).

## What problem are we solving?

An Agricultural Supply Chain tracks a farm product from the farmer to the consumer. Farmers in developing countries are heavily dependent on bank loans.
Due to this heavy debt , farmers can't maintain a steady production of agriculture. Micro-finance can help these farmers out of debt.

## Our solution to the problem:

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/Farmer%20Registration%20Page.PNG?raw=true "Farmer Registration")

The above figure shows the registration form for the farmer in the supply chain application. The entered details are stored directly onto the blockchain. The underlying technology uses Truffle for the deployment and go-ethereum(geth) as the backend blockchain. We use the Web3 Javascript provider API to interact with the blockchain.

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/Quality.PNG?raw=true "Farmer Registration")

The next page is for quality testing, here we can get the farmer details by Farmer Id. These details are stored as a structure using solidity code onto the blockchain. The Farmer details are retrieved using a special data structure called mapping by Farmer Id. 

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/View%20Blocks.PNG?raw=true "Quality Testing")
This is the Quality Testing page.
Here we can see the block details where the farmer’s details are stored onto blockchain. The ‘Approve Details’ will approve the details of the farmer.

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/QualityTestingProduct.PNG?raw=true "Product Testing")

Approve Details button click will redirect to this Product details page. This is also part of the quality testing where we enter the lot number, grade, price, test date and expiry date. These details are also stored in the blockchain as a structure.

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/CustomerDetails.PNG?raw=true "Customer Details")

This is the customer page where the customer can check the customer details and status of the quality testing of his agriculture produce. The customer has to enter the farmer id and Lot number to see the details. These customer details are retrieved from the blockchain.

![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/Micro-Finance.PNG?raw=true "Micro-Finance")

The micro-finance form enables any user to fund a farmer. The funding is done by providing the farmers public id, the lot number of the product and the amount.

# System Architecture


![Alt text](https://github.com/nikhilvc1990/AgriChain/blob/master/screenshots/AgriChain.jpg?raw=true "Flow Chart")

