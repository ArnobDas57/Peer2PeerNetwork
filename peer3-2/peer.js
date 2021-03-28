let net = require('net');
let cPTPpacket = require('./cPTPmessagePacket');
let singleton = require('./Singleton');
const fs = require('fs');
let peerTable = {}, isFull = {};
let os = require('os');
let ifaces = os.networkInterfaces();
let HOST = '';
singleton.init();
let PORT = singleton.getPort(); //get random PEER port 

// get the loaclhost ip address
Object.keys(ifaces).forEach(function (ifname) {
    ifaces[ifname].forEach(function (iface) {
        if ('IPv4' == iface.family && iface.internal !== false) {
            HOST = iface.address;
        }
    });
});

// get current folder name
let path = __dirname.split("\\");
let peerLocation = path[path.length - 1];
let stringPeer = '';

if (peerLocation.includes('1-2')) {
    stringPeer = '1';
}

else if(peerLocation.includes('2-3')) {
    stringPeer = '2';
}

else if(peerLocation.includes('3-2')) {
    stringPeer = '3';
}

else {
    stringPeer = '4';
}

// Address Objects
let localPeer = {'port': PORT, 'IP': HOST};
let knownPeer = {};

// run as a PEER server
let serverPeer = net.createServer();
serverPeer.listen(PORT, HOST);
console.log('This peer address is ' +  HOST + ':' + PORT +  ' located at peer' + stringPeer);

// initialize peer and known peers tables
let declinedPeerTable = {};
serverPeer.on('connection', function (sock) {
    // received PEER connection request
    handleClientJoining(sock, peerLocation, peerTable, declinedPeerTable);
});

if (process.argv.length > 2) {
    // call as node peer [-p <serverIP>:<port> -v <version>]
    
    knownPeer = {'port': parseInt(process.argv[3].split(':')[1]), 'IP': process.argv[3].split(':')[0]};

    if (knownPeer.IP) // connect to peer from process.argv arguments
    {
        handleConnect(knownPeer, localPeer, peerLocation, peerTable, declinedPeerTable);
    }
}

//////////

// this function accepts client requests
function addClient(peer, peerTable) {
    let peerAddress = peer.IP + ':' + peer.port;
    peerTable[peerAddress] = {'port': peer.port, 'IP': peer.IP, 'status': 'peered'};

    console.log('\nConnected from peer ' + peerAddress);
}

// this function handles accpeting clients and sends a message
function handleClient(sock, sender, peer, peerTable) {
    addClient(peer, peerTable);

     // send acknowledgment to the client
     cPTPpacket.init(1, sender, peerTable);
     sock.write(cPTPpacket.getPacket());
     sock.end();
}

// this function declines peer connections and sends decline message
function declineClient(sock, sender, peerTable, declinedPeerTable, peer) {
    let peerAddress = peer.IP + ':' + peer.port; 
    declinedPeerTable[peerAddress] = {'port': peer.port, 'IP': peer.IP};

    console.log('\nPeer table full: ' + peerAddress + ' redirected');

    // send acknowledgerment to the client
    cPTPpacket.init(2, sender, peerTable);
    sock.write(cPTPpacket.getPackjet());
    sock.end();
}

function bytesToNum(array) {
    var result = "";

    for(let i = 0; i < array.length; i++) {
        result ^= result + array[array.length - i - 1] << 8 * 1; 
    }

    return result;
}

function bytesToString(array) {
    var result = "";

    for(let i = 0; i < array.length; i++) {
        if(array[i] > 0) {
            result += (String.fromCharCode(array[i])); 
        }
    }

    return result;
}

function handleClientJoining(sock, sender, peerTable, declinedPeerTable) {
    sock.on('data', (message) => {

        let peersCount = Object.keys(peerTable).length; 
        let addressSent = bytesToString(message).split(':');
        let peer = {'port': addressSent[1], 'IP': addressSent[0]};

        if (peersCount === 4) { 
            declineClient(sock, sender, peerTable, declinedPeerTable,peer);
        }
        
        else {
            handleClient(sock, sender, peer, peerTable);
        }
    })
}

function handleConnect (knownPeer, localPeer, peerLocation, peerTable, declinedPeerTable) {
    let pendingPeer = {'port': knownPeer.port, 'IP': knownPeer.IP, 'status': 'pending'};
    let peerAddress = pendingPeer.IP + ':' + pendingPeer.port;
    peerTable[peerAddress] = pendingPeer;
    let clientPeer = new net.Socket();

    clientPeer.connect(knownPeer.port, knownPeer.IP, function () {
        handleCommunication(clientPeer, peerLocation, peerTable, localPeer,declinedPeerTable);
        clientPeer.write(localPeer.IP + ':' + localPeer.port);
    });

    clientPeer.on('error', function () {
        declinedPeerTable[peerAddress] = {'port': knownPeer.port, 'IP': knownPeer.IP, 'status': 'error'};
        delete peerTable[peerAddress];
    });
}

function handleCommunication(client, location, peerTable, localPeer, declinedPeerTable) {
    client.on('data', (message) => {
        let version = bytesToNum(message.slice(0, 3));
        let msgType = bytesToNum(message.slice(3, 4));
        let sender = bytesToString(message.slice(4, 8));
        let numberOfPeers = bytesToNum(message.slice(8, 12));
        let peerList = {};

        // Get list of known peers of connected peer
        for (var i = 0; i < numberOfPeers; i++) {
            let peerPort = bytesToNum(message.slice(14 + i*8, 16 + i*8));
            let peerIP = bytesToNum(message.slice(16 + i*8, 17 + i*8)) + '.'
                + bytesToNum(message.slice(17 + i*8, 18 + i*8)) + '.'
                + bytesToNum(message.slice(18 + i*8, 19 + i*8)) + '.'
                + bytesToNum(message.slice(19 + i*8, 20 + i*8));
            let peerAddress = peerIP + ':' + peerPort;
            
            if(peerPort != localPeer.port  && !(peerPort in peerTable)) {
                peerList[peerAddress] = {'port': peerPort, 'IP': peerIP, 'status': 'pending'};
            }
        }
        
        // IF is a Welcome message
        if (msgType == 1) {
            isFull[client.remotePort] = false;
            console.log("\nConnected to peer " + sender + ":" + client.remotePort + " at timestamp: " + singleton.getTimestamp());

            // add the server into peer table
            let receiverPeer = {'port': client.remotePort, 'IP': client.remoteAddress};
            let peerAddress = receiverPeer.IP + ':' + receiverPeer.port;
            peerTable[peerAddress] = {'port': client.remotePort, 'IP': client.remoteAddress, 'status': 'peered'};
            console.log("Received ack from " + sender + ":" + client.remotePort);
            
            Object.values(peerList).forEach(peer => {
                let peerAddress = peer.IP + ':' + peer.port;
                
                if(peer.port != client.localPort && !(peerAddress == Object.keys(peerTable)[0])) {
                    let peerAddress = peer.IP + ':' + peer.port;
                    
                    console.log("  which is peered with: [" + peer.IP + ":" + peer.port + "]");
                
                    peerTable[peerAddress] = {'port': peer.port, 'IP': peer.IP, 'status': 'pending'};
                }
            });
        } 
        
        else { // IF is a DECLINED message
            console.log("Received ack from " + sender + ":" + client.remotePort);
            
            isFull[client.remotePort] = true;

            Object.values(peerList).forEach(peer => {
                let peerAddress = peer.IP + ':' + peer.port;

                if(peer.port != client.remotePort && !(peerAddress == Object.keys(peerTable)[0])) {
                
                console.log("  which is peered with: [" + peer.IP + ":" + peer.port + "]");
                let peerAddress = peer.IP + ':' + peer.port;
                peerTable[peerAddress] = {'port': peer.port, 'IP': peer.IP, 'status': 'pending'};
                }
            });

            console.log("\nThe join has been declined; the auto-join process is performing ...");
            
            // remove the server (the receiver request) from the peerTable, and status 'Declined' in unpeerTable
            let peerAddress = client.remoteAddress + ':' + client.remotePort;
            delete peerTable[peerAddress];
            declinedPeerTable[peerAddress] = {'port': client.remotePort, 'IP': client.remoteAddress, 'status': 'declined'};
        }
    }); 
}