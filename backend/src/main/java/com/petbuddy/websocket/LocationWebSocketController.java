package com.petbuddy.websocket;

import com.petbuddy.dto.RideDto;
import com.petbuddy.service.RideService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;

import java.security.Principal;

/**
 * WebSocket controller for real-time driver location updates
 *
 * Clients send location updates to:  /app/location.update
 * Users subscribe to ride updates at: /topic/ride/{rideId}
 */
@Controller
public class LocationWebSocketController {

    @Autowired
    private RideService rideService;

    /**
     * Handles live location updates from drivers
     * Driver sends: { rideId, driverId, latitude, longitude }
     * Broadcasts to: /topic/ride/{rideId}
     */
    @MessageMapping("/location.update")
    public void updateLocation(@Payload RideDto.LocationUpdate locationUpdate,
                               Principal principal) {
        if (principal == null) {
            throw new RuntimeException("Authentication required for WebSocket");
        }

        rideService.updateDriverLocation(
                locationUpdate.getRideId(),
                locationUpdate.getLatitude(),
                locationUpdate.getLongitude(),
                principal.getName()
        );
    }
}
